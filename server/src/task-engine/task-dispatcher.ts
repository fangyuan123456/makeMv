/**
 * task-engine/task-dispatcher.ts
 * 统一任务调度分发器 (Task Dispatcher SSOT)
 */

import { taskToolRegistry } from './task-registry.js';
import { taskStore } from './task-store.js';
import './asset-sync.js';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { ConcurrencyPool, KeyedLockManager } from '../workflow-engine/concurrency.js';
import { config } from '../utils/config.js';
import type { TaskRecord, TaskFailureRecord } from './types.js';
import {
  recordTaskFailure,
  buildLLMReflectionPrompt,
} from './task-failure.js';

export interface DispatchTaskParams {
  projectId: string;
  toolName: string;
  input: Record<string, any>;
  idempotencyKey?: string;
  recoveryAttempts?: number;
  replacesTaskId?: string;
  lastFailure?: TaskFailureRecord;
  retryCount?: number;
  maxRetries?: number;
  autoRetry?: boolean;
  /** 前置依赖任务 ID（用于多步 Plan Wave 编排：必须等全部前置任务终态后再进入执行） */
  dependsOnTaskIds?: string[];
}

/**
 * 委派已注册工具自身声明细粒度实体互斥键（零调度器业务硬编码）；返回 null 表示需持有项目独占排他锁
 */
export function resolveTaskEntityLockKey(
  projectId: string,
  toolName: string,
  input?: Record<string, any>
): string | null {
  const tool = taskToolRegistry.getTool(toolName);
  if (!tool || typeof tool.resolveConcurrencyKey !== 'function') return null;
  return tool.resolveConcurrencyKey(projectId, input);
}

/**
 * 项目级轻量共享/独占协调门（读者-写者公平队列）：
 * - shared（单实体原子渲染）：允许同项目最多 N 个不同实体并发执行；
 * - exclusive（全剧结构变更工具）：等待当前活跃 shared 全部归零后独占执行，杜绝跨阶段脏写。
 */
class ProjectExecutionGate {
  private activeShared = 0;
  private activeExclusive = false;
  private queue: Array<{
    mode: 'shared' | 'exclusive';
    resolve: (release: () => void) => void;
    reject: (err: any) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  public acquire(mode: 'shared' | 'exclusive', abortSignal?: AbortSignal): Promise<() => void> {
    if (abortSignal?.aborted) {
      return Promise.reject(new Error('任务已取消'));
    }
    if (this.canGrantImmediately(mode)) {
      return Promise.resolve(this.grant(mode));
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: (typeof this.queue)[number] = { mode, resolve, reject, signal: abortSignal };
      if (abortSignal) {
        const onAbort = () => {
          const idx = this.queue.indexOf(waiter);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(new Error('任务已取消'));
        };
        waiter.onAbort = onAbort;
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  private canGrantImmediately(mode: 'shared' | 'exclusive'): boolean {
    if (this.queue.length > 0) return false;
    if (mode === 'shared') return !this.activeExclusive;
    return !this.activeExclusive && this.activeShared === 0;
  }

  private grant(mode: 'shared' | 'exclusive'): () => void {
    if (mode === 'shared') this.activeShared++;
    else this.activeExclusive = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (mode === 'shared') this.activeShared = Math.max(0, this.activeShared - 1);
      else this.activeExclusive = false;
      this.drain();
    };
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (head.signal?.aborted) {
        this.queue.shift();
        continue;
      }
      if (head.mode === 'shared' && !this.activeExclusive) {
        this.queue.shift();
        if (head.signal && head.onAbort) head.signal.removeEventListener('abort', head.onAbort);
        head.resolve(this.grant('shared'));
        continue;
      }
      if (head.mode === 'exclusive' && !this.activeExclusive && this.activeShared === 0) {
        this.queue.shift();
        if (head.signal && head.onAbort) head.signal.removeEventListener('abort', head.onAbort);
        head.resolve(this.grant('exclusive'));
        break;
      }
      break;
    }
  }
}

function isTerminalTaskStatus(status?: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export class TaskDispatcher {
  private static instance: TaskDispatcher | null = null;
  private abortControllers = new Map<string, AbortController>();
  private projectStore = ProjectStore.getInstance();
  private entityLockManager = new KeyedLockManager();
  private projectGates = new Map<string, ProjectExecutionGate>();
  private projectConcurrencyPools = new Map<string, ConcurrencyPool>();
  private recoveryStarted = false;

  private getProjectGate(projectId: string): ProjectExecutionGate {
    let gate = this.projectGates.get(projectId);
    if (!gate) {
      gate = new ProjectExecutionGate();
      this.projectGates.set(projectId, gate);
    }
    return gate;
  }

  private getProjectPool(projectId: string): ConcurrencyPool {
    let pool = this.projectConcurrencyPools.get(projectId);
    if (!pool) {
      pool = new ConcurrencyPool(config.plan.maxConcurrency);
      this.projectConcurrencyPools.set(projectId, pool);
    }
    return pool;
  }

  private constructor() {
    taskStore.setActiveChecker((taskId) => this.isTaskActive(taskId));
  }

  /**
   * 仅由主服务在端口监听成功后显式调用，恢复因服务重启中断的任务，避免模块导入期或端口冲突进程误抢占写盘
   */
  public startRecovery(): void {
    if (this.recoveryStarted) return;
    this.recoveryStarted = true;
    queueMicrotask(() => {
      void this.recoverInterruptedTasks();
    });
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

    // 智能提取反思自愈上下文（让大模型下次执行时自动改进）
    const reflectionPrompt = buildLLMReflectionPrompt(task);
    if (reflectionPrompt) {
      input._reflectionContext = reflectionPrompt;
    }

    return this.dispatch({
      projectId: task.projectId,
      toolName: task.toolName,
      input,
      idempotencyKey: retryKey,
      recoveryAttempts: task.recoveryAttempts,
      replacesTaskId: task.taskId,
      lastFailure: task.lastFailure,
      retryCount: (task.retryCount || 0) + 1,
      maxRetries: 0,
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
      ...(params.replacesTaskId ? { replacesTaskId: params.replacesTaskId } : {}),
      ...(params.recoveryAttempts ? { recoveryAttempts: params.recoveryAttempts } : {}),
      ...(params.lastFailure ? { lastFailure: params.lastFailure } : {}),
      retryCount: params.retryCount ?? 0,
      maxRetries: params.maxRetries ?? 0,
      status: 'pending',
      input: idempotencyKey ? { ...input, __idempotencyKey: idempotencyKey } : input,
      createdAt: now,
    };

    // 1. 同步保存初始状态并准备派发
    try {
      taskStore.saveTask(initialTask);
    } catch (error) {
      this.abortControllers.delete(taskId);
      throw error;
    }

    // 2. 异步非阻塞执行任务（支持前置 Wave 依赖等待）
    const dependsOnTaskIds = params.dependsOnTaskIds?.filter(Boolean) || [];
    queueMicrotask(() => {
      this.runTaskAsync(tool, initialTask, abortController, dependsOnTaskIds).catch((err) => {
        console.error(`[TaskDispatcher] 任务 ${taskId} 异常失控:`, err);
      }).finally(() => {
        this.abortControllers.delete(taskId);
      });
    });

    return initialTask;
  }

  private async waitForDependencies(dependsOnTaskIds: string[], abortSignal: AbortSignal): Promise<void> {
    if (!dependsOnTaskIds.length) return;
    const isAllSettled = () =>
      dependsOnTaskIds.every((id) => {
        const dep = taskStore.getTask(id);
        return !dep || isTerminalTaskStatus(dep.status);
      });
    if (abortSignal.aborted || isAllSettled()) return;

    await new Promise<void>((resolve) => {
      let done = false;
      let unsubscribe = () => {};
      const finish = () => {
        if (done) return;
        done = true;
        unsubscribe();
        abortSignal.removeEventListener('abort', finish);
        resolve();
      };
      unsubscribe = taskStore.onTaskEvent((event) => {
        if (dependsOnTaskIds.includes(event.taskId) && isTerminalTaskStatus(event.status) && isAllSettled()) {
          finish();
        }
      });
      abortSignal.addEventListener('abort', finish, { once: true });
      if (isAllSettled()) finish();
    });
  }

  /**
   * 异步执行任务生命周期
   */
  private async runTaskAsync(
    tool: any,
    task: TaskRecord,
    abortController: AbortController,
    dependsOnTaskIds: string[] = []
  ): Promise<void> {
    const currentTask: TaskRecord = {
      ...task,
      status: 'pending',
    };
    taskStore.saveTask(currentTask);

    try {
      // 0. 若存在前置 Wave 依赖，保持 pending 等待前序波次全部结束
      await this.waitForDependencies(dependsOnTaskIds, abortController.signal);
      if (abortController.signal.aborted || currentTask.status === 'cancelled') return;

      const {
        __chatContext: _chatContext,
        __idempotencyKey: _idempotencyKey,
        ...toolInput
      } = task.input as any;
      const finalInput = {
        ...toolInput,
        projectId: task.projectId,
      };

      const executeBody = async () => {
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
                if ((result as any)?.failureType) {
                  currentTask.failureType = (result as any).failureType;
                }
                this.finishTask(currentTask, 'failed', currentTask.error || '执行失败');
              }
            },
          },
        });
      };

      const entityLockKey = resolveTaskEntityLockKey(task.projectId, task.toolName, finalInput);
      const gate = this.getProjectGate(task.projectId);

      if (entityLockKey) {
        // 单实体原子渲染工具：同实体互斥 + 同项目受控并发池（不持有粗粒度整任务项目锁）
        const releaseGate = await gate.acquire('shared', abortController.signal);
        try {
          const pool = this.getProjectPool(task.projectId);
          await pool.run(
            () => this.entityLockManager.withLock(entityLockKey, executeBody),
            abortController.signal
          );
        } finally {
          releaseGate();
        }
      } else {
        // 全剧结构变更工具：项目独占排他执行 + store 写锁
        const releaseGate = await gate.acquire('exclusive', abortController.signal);
        try {
          await this.projectStore.withProjectLock(task.projectId, executeBody);
        } finally {
          releaseGate();
        }
      }
    } catch (err: any) {
      if (currentTask.status === 'cancelled' || abortController.signal.aborted) {
        return;
      }
      currentTask.error = err?.message || String(err);
      if (err?.failureType) {
        currentTask.failureType = err.failureType;
      }
      this.finishTask(currentTask, 'failed', currentTask.error || '执行失败');
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

    if (status === 'failed') {
      const errText = task.error || message;
      // 百分百源头治理：底座不猜测，直接记录源头赋予的 failureType
      recordTaskFailure(task, errText, task.failureType);
    }

    taskStore.saveTask(task);
  }
}

export const taskDispatcher = TaskDispatcher.getInstance();
