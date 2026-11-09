/**
 * workflow-engine/TaskStore.ts
 * 任务生命周期持久化与管理门面 (TaskStore SSOT)
 */

import path from 'path';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../utils/atomicFile.js';
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
   * 检查当前项目是否正有任务处于 running 状态 (轻量防抖与互斥门禁)
   */
  public getRunningTask(projectId: string): Task | null {
    const tasks = this.listTasks(projectId);
    return tasks.find((t) => t.status === 'running') || null;
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
}
