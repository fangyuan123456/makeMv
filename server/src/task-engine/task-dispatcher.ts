/**
 * task-engine/task-dispatcher.ts
 * 统一任务调度分发器 (Task Dispatcher SSOT)
 */

import { taskToolRegistry } from './task-registry.js';
import { taskStore } from './task-store.js';
import './asset-sync.js';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { syncTaskCompletionToChat } from '../chat/task-message-sync.js';
import type { TaskRecord } from './types.js';

export interface DispatchTaskParams {
  projectId: string;
  toolName: string;
  input: Record<string, any>;
  idempotencyKey?: string;
  recoveryAttempts?: number;
  replacesTaskId?: string;
}

export class TaskDispatcher {
  private static instance: TaskDispatcher | null = null;
  private abortControllers = new Map<string, AbortController>();
  private projectStore = ProjectStore.getInstance();

  private constructor() {
    taskStore.setActiveChecker((taskId) => this.isTaskActive(taskId));
    queueMicrotask(() => this.recoverInterruptedTasks());
  }

  public static getInstance(): TaskDispatcher {
    if (!this.instance) {
      this.instance = new TaskDispatcher();
    }
    return this.instance;
  }

  /**
   * 检查指定任务是否处于当前进程的活跃执行池中
   */
  public isTaskActive(taskId: string): boolean {
    return this.abortControllers.has(taskId);
  }

  /**
   * 取消指定正在执行的任务
   */
  public cancel(taskId: string): boolean {
    const controller = this.abortControllers.get(taskId);
    const task = taskStore.getTask(taskId);
    if (!task) return false;

    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }

    if (task.status === 'pending' || task.status === 'running') {
      this.finishTask(task, 'cancelled', '任务已取消');
      return true;
    }
    return false;
  }

  public async retry(taskId: string): Promise<TaskRecord> {
    const task = taskStore.getTask(taskId);
    if (!task) throw new Error(`[TaskDispatcher] 未找到任务: "${taskId}"`);
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new Error(`[TaskDispatcher] 仅允许重试 failed/cancelled 任务 (当前状态: ${task.status})`);
    }

    const input = { ...(task.input as Record<string, any>) };
    delete input.__idempotencyKey;
    const retryKey = task.idempotencyKey
      ? `${task.idempotencyKey}:retry:${Date.now()}`
      : undefined;
    return this.dispatch({
      projectId: task.projectId,
      toolName: task.toolName,
      input,
      idempotencyKey: retryKey,
      recoveryAttempts: task.recoveryAttempts,
      replacesTaskId: task.taskId,
    });
  }

  private async recoverInterruptedTasks(): Promise<void> {
    const interrupted = taskStore.listRestartRecoverableTasks();
    for (const task of interrupted) {
      task.recoveryAttempts = (task.recoveryAttempts || 0) + 1;
      task.recovery = undefined;
      taskStore.saveTask(task);
      try {
        await this.retry(task.taskId);
      } catch (err) {
        console.error(`[TaskDispatcher] 自动恢复任务 ${task.taskId} 失败:`, err);
      }
    }
  }

  /**
   * 派发任务：同步立即返回 pending 状态的任务凭证，后台异步启动执行
   */
  public async dispatch(params: DispatchTaskParams): Promise<TaskRecord> {
    const { projectId, toolName, input } = params;

    if (!projectId || !toolName) {
      throw new Error(`[TaskDispatcher] 缺少必须参数: projectId 或 toolName`);
    }

    const tool = taskToolRegistry.getTool(toolName);
    if (!tool) {
      throw new Error(`[TaskDispatcher] 未找到注册的工具: "${toolName}"`);
    }

    const idempotencyKey = params.idempotencyKey || input?.__idempotencyKey;
    if (idempotencyKey) {
      const existing = taskStore.findByIdempotencyKey(projectId, idempotencyKey);
      if (existing) return existing;
    }

    const now = Date.now();
    const cleanToolName = toolName.replace(/[^a-zA-Z0-9_]/g, '_');
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const taskId = `task_${cleanToolName}_${now}_${randomSuffix}`;

    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    const initialTask: TaskRecord = {
      taskId,
      projectId,
      toolName,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(params.recoveryAttempts ? { recoveryAttempts: params.recoveryAttempts } : {}),
      status: 'pending',
      input: idempotencyKey ? { ...input, __idempotencyKey: idempotencyKey } : input,
      createdAt: now,
    };

    // 1. 同步保存初始状态并准备派发
    taskStore.saveTask(initialTask);

    if (params.replacesTaskId) {
      const context = input?.__chatContext;
      syncTaskCompletionToChat(projectId, context, {
        taskId,
        taskStatus: 'pending',
        taskProgress: undefined,
        taskDurationMs: undefined,
        taskError: undefined,
      }, params.replacesTaskId);
    }

    // 2. 异步非阻塞执行任务
    queueMicrotask(() => {
      this.runTaskAsync(tool, initialTask, abortController).catch((err) => {
        console.error(`[TaskDispatcher] 任务 ${taskId} 异常失控:`, err);
      }).finally(() => {
        this.abortControllers.delete(taskId);
      });
    });

    return initialTask;
  }

  /**
   * 异步执行任务生命周期
   */
  private async runTaskAsync(
    tool: any,
    task: TaskRecord,
    abortController: AbortController
  ): Promise<void> {
    const currentTask: TaskRecord = {
      ...task,
      status: 'pending',
    };
    taskStore.saveTask(currentTask);

    try {
      const {
        __chatContext: _chatContext,
        __idempotencyKey: _idempotencyKey,
        ...toolInput
      } = task.input as any;
      const finalInput = {
        ...toolInput,
        projectId: task.projectId,
      };

      await this.projectStore.withProjectLock(task.projectId, async () => {
        if (abortController.signal.aborted || currentTask.status === 'cancelled') return;

        const executionStartedAt = Date.now();
        currentTask.status = 'running';
        currentTask.startedAt = executionStartedAt;
        taskStore.saveTask(currentTask);

        await tool.execute({
          input: finalInput,
          options: {
            customTaskId: task.taskId,
            abortSignal: abortController.signal,
          },
          callbacks: {
            onTaskId: (_internalTaskId: string) => {
              // 工具内部已接单并生成内部标识，保持同步
              currentTask.taskId = task.taskId;
            },
            onProgress: ({ percent, note }: { percent: number; note: string }) => {
              if (currentTask.status === 'cancelled' || abortController.signal.aborted) {
                return;
              }
              currentTask.progress = {
                current: percent,
                total: 100,
                percent,
                message: note,
              };
              taskStore.saveTask(currentTask);
            },
            onResult: (result: any) => {
              // 取消已经收敛为终态后，忽略迟到的 workflow 回调。
              if (currentTask.status === 'cancelled' || abortController.signal.aborted) {
                return;
              }
              if (result.success) {
                currentTask.output = result.data;
                this.finishTask(currentTask, 'completed', '推演完成');
              } else {
                currentTask.error = result.error || '任务执行返回失败';
                this.finishTask(currentTask, 'failed', '执行失败');
              }
            },
          },
        });
      });
    } catch (err: any) {
      if (currentTask.status === 'cancelled' || abortController.signal.aborted) {
        return;
      }
      currentTask.error = err?.message || String(err);
      this.finishTask(currentTask, 'failed', '执行失败');
    }
  }

  private finishTask(task: TaskRecord, status: 'completed' | 'failed' | 'cancelled', message: string): void {
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return;
    const completedAt = Date.now();
    task.status = status;
    task.completedAt = completedAt;
    task.durationMs = task.startedAt ? completedAt - task.startedAt : 0;
    task.progress = {
      current: status === 'completed' ? 100 : 0,
      total: 100,
      percent: status === 'completed' ? 100 : 0,
      message,
    };
    taskStore.saveTask(task);
  }
}

export const taskDispatcher = TaskDispatcher.getInstance();
