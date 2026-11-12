/**
 * workflow-engine/TaskStore.ts
 * 任务生命周期持久化与管理门面 (TaskStore SSOT)
 */

import fs from 'fs';
import path from 'path';
import { config } from '../utils/config.js';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../utils/atomicFile.js';
import { getRunContext, throwIfRunAborted } from './run-context.js';
import type { Task, TaskStatus, TaskProgress } from './types.js';

export class TaskStore {
  private static instance: TaskStore | null = null;
  private cache: Map<string, Task[]> = new Map();

  private constructor() {}

  public static getInstance(): TaskStore {
    if (!this.instance) {
      this.instance = new TaskStore();
    }
    return this.instance;
  }

  private getTasksFilePath(projectId: string): string {
    const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
    return path.join(projectDir, 'tasks.json');
  }

  public listTasks(projectId: string, filter?: { status?: TaskStatus }): Task[] {
    let tasks: Task[];
    if (this.cache.has(projectId)) {
      tasks = this.cache.get(projectId)!;
    } else {
      const filePath = this.getTasksFilePath(projectId);
      tasks = safeReadJsonSync<Task[]>(filePath) || [];
      this.cache.set(projectId, tasks);
    }

    if (filter?.status) {
      return tasks.filter((t) => t.status === filter.status);
    }
    return tasks;
  }

  public getTask(projectId: string, taskId: string): Task | null {
    const tasks = this.listTasks(projectId);
    return tasks.find((t) => t.taskId === taskId) || null;
  }

  /**
   * 检查当前项目是否正有任务处于 running 或 queued 状态 (轻量防抖与互斥门禁)
   */
  public getRunningTask(projectId: string): Task | null {
    const tasks = this.listTasks(projectId);
    return tasks.find((t) => t.status === 'running' || t.status === 'queued') || null;
  }

  /**
   * 服务启动时清扫遗留中断态：
   * 进程重启导致内存执行上下文丢失，孤儿 running / queued 转为 failed 释放执行槽，
   * 阶段挂起审批态 (suspended) 完整保留以便创作者继续确认。
   */
  public recoverInterruptedTasks(): number {
    const projectsRoot = config.paths.projects;
    if (!fs.existsSync(projectsRoot)) return 0;

    let recovered = 0;
    for (const dir of fs.readdirSync(projectsRoot)) {
      const tasksPath = path.join(projectsRoot, dir, 'tasks.json');
      if (!fs.existsSync(tasksPath)) continue;

      const tasks = this.listTasks(dir);
      let changed = false;
      const now = new Date().toISOString();

      for (const task of tasks) {
        if (task.status === 'running' || task.status === 'queued') {
          task.status = 'failed';
          task.error = '服务端重启导致运行中断，请重新发起或重试';
          task.updatedAt = now;
          task.progress = {
            ...task.progress,
            note: '服务重启中断，项目执行通道已释放',
          };
          changed = true;
          recovered++;
        }
      }

      if (changed) {
        this.cache.set(dir, tasks);
        atomicWriteJsonSync(tasksPath, tasks);
      }
    }

    return recovered;
  }

  public saveTask(projectId: string, task: Task): void {
    const tasks = this.listTasks(projectId);
    const idx = tasks.findIndex((t) => t.taskId === task.taskId);
    task.updatedAt = new Date().toISOString();

    if (idx >= 0) {
      tasks[idx] = task;
    } else {
      tasks.push(task);
    }

    this.cache.set(projectId, tasks);
    const filePath = this.getTasksFilePath(projectId);
    atomicWriteJsonSync(filePath, tasks);
  }

  public createTask(
    projectId: string,
    workflowKey: string,
    title: string,
    requireConfirmation: boolean = true,
    payload?: any
  ): Task {
    const now = new Date().toISOString();
    const task: Task = {
      taskId: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      projectId,
      workflowKey,
      title,
      status: requireConfirmation ? 'proposed' : 'running',
      progress: { current: 0, total: 100, percent: 0, note: '已就绪' },
      requireConfirmation,
      payload,
      createdAt: now,
      updatedAt: now,
    };
    this.saveTask(projectId, task);
    return task;
  }

  public updateProgress(
    projectId: string,
    taskId: string,
    progress: Partial<TaskProgress>
  ): void {
    const task = this.getTask(projectId, taskId);
    if (!task) return;

    task.progress = {
      ...task.progress,
      ...progress,
    };
    this.saveTask(projectId, task);
  }

  public setStatus(
    projectId: string,
    taskId: string,
    status: TaskStatus,
    extras?: { result?: any; error?: string }
  ): Task {
    const task = this.getTask(projectId, taskId);
    if (!task) throw new Error(`[TaskStore] 未找到任务: ${taskId}`);

    task.status = status;
    if (extras?.result !== undefined) task.result = extras.result;
    if (extras?.error !== undefined) task.error = extras.error;
    if (status === 'succeeded') {
      task.progress = { current: 100, total: 100, percent: 100, note: '执行成功' };
    }

    this.saveTask(projectId, task);
    return task;
  }

  /**
   * 读取任务中已成功记录的 Step 输出（用于恢复时 Step 内自判跳过）
   */
  public getCompletedStepOutput<T = any>(
    projectId: string,
    taskId: string,
    stepId: string
  ): T | undefined {
    const task = this.getTask(projectId, taskId);
    const map = (task?.result as any)?.completedSteps;
    if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, stepId)) {
      return map[stepId] as T;
    }
    return undefined;
  }

  /**
   * 每执行完成一个 Step 时即刻记录到当前 Task 上
   */
  public recordCompletedStep(
    projectId: string,
    taskId: string,
    stepId: string,
    output: any
  ): void {
    const task = this.getTask(projectId, taskId);
    if (!task) return;
    const prevResult = task.result && typeof task.result === 'object' ? { ...task.result } : {};
    const prevSteps =
      prevResult.completedSteps && typeof prevResult.completedSteps === 'object'
        ? { ...prevResult.completedSteps }
        : {};
    prevSteps[stepId] = output;
    task.result = {
      ...prevResult,
      completedSteps: prevSteps,
    };
    this.saveTask(projectId, task);
  }
}

/**
 * 在当前任务上下文下执行原子 Step：
 * - 若该 Step 已在当前 Task 记录为完成，直接返回已记录结果；
 * - 否则正常执行，成功后立即将结果记入当前 Task。
 */
export async function runTaskRecordedStep<T>(
  stepId: string,
  execute: () => Promise<T>,
  options?: {
    skipCache?: boolean;
    verifyCached?: (cached: T) => boolean | Promise<boolean>;
    onCacheHit?: (cached: T) => void | Promise<void>;
  }
): Promise<T> {
  throwIfRunAborted(stepId);
  const runCtx = getRunContext();
  const store = TaskStore.getInstance();

  if (runCtx && !options?.skipCache) {
    const cached = store.getCompletedStepOutput<T>(runCtx.projectId, runCtx.runId, stepId);
    if (cached !== undefined) {
      const valid = options?.verifyCached ? await options.verifyCached(cached) : true;
      if (valid) {
        console.log(`[WorkflowStep] 任务 [${runCtx.runId}] 步骤 [${stepId}] 已完成，直接成功`);
        if (options?.onCacheHit) {
          await options.onCacheHit(cached);
        }
        return cached;
      }
    }
  }

  const output = await execute();
  throwIfRunAborted(stepId);

  if (runCtx) {
    store.recordCompletedStep(runCtx.projectId, runCtx.runId, stepId, output);
  }
  return output;
}
