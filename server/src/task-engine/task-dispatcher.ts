/**
 * task-engine/task-dispatcher.ts
 * 统一任务调度分发器 (Task Dispatcher SSOT)
 */

import { taskToolRegistry } from './task-registry.js';
import { taskStore } from './task-store.js';
import { syncTaskResultToProjectStore } from './asset-sync.js';
import type { TaskRecord } from './types.js';

export interface DispatchTaskParams {
  projectId: string;
  toolName: string;
  input: Record<string, any>;
}

export class TaskDispatcher {
  private static instance: TaskDispatcher | null = null;
  private abortControllers = new Map<string, AbortController>();

  private constructor() {
    taskStore.setActiveChecker((taskId) => this.isTaskActive(taskId));
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
      task.status = 'cancelled';
      task.completedAt = Date.now();
      task.durationMs = task.startedAt ? task.completedAt - task.startedAt : 0;
      taskStore.saveTask(task);
      return true;
    }
    return false;
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
      status: 'pending',
      input,
      createdAt: now,
    };

    // 1. 同步保存初始状态并准备派发
    taskStore.saveTask(initialTask);

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
    const startedAt = Date.now();
    const currentTask: TaskRecord = {
      ...task,
      status: 'running',
      startedAt,
    };
    taskStore.saveTask(currentTask);

    try {
      const finalInput = {
        ...task.input,
        projectId: task.projectId,
      };

      await tool.execute({
        input: finalInput,
        options: {
          customTaskId: task.taskId,
          abortSignal: abortController.signal,
        },
        callbacks: {
          onTaskId: (internalTaskId: string) => {
            // 工具内部已接单并生成内部标识，保持同步
            currentTask.taskId = task.taskId;
          },
          onResult: (result: any) => {
            const completedAt = Date.now();
            currentTask.completedAt = completedAt;
            currentTask.durationMs = completedAt - startedAt;

            if (result.success) {
              currentTask.status = 'completed';
              currentTask.output = result.data;
              // 自动将任务产物同步到项目全局黑板与磁盘文件
              syncTaskResultToProjectStore(currentTask);
            } else {
              currentTask.status = 'failed';
              currentTask.error = result.error || '任务执行返回失败';
            }
            taskStore.saveTask(currentTask);
          },
        },
      });
    } catch (err: any) {
      const completedAt = Date.now();
      currentTask.status = 'failed';
      currentTask.completedAt = completedAt;
      currentTask.durationMs = completedAt - startedAt;
      currentTask.error = err?.message || String(err);
      taskStore.saveTask(currentTask);
    }
  }
}

export const taskDispatcher = TaskDispatcher.getInstance();
