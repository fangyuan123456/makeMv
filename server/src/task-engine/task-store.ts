/**
 * task-engine/task-store.ts
 * 任务状态管理与轻量持久化中枢 (Task Store SSOT)
 */

import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import { getProjectDir } from '../project-store/artifact-fs.js';
import { config } from '../utils/config.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../utils/atomicFile.js';
import type { TaskRecord, TaskEventPayload, TaskEventListener } from './types.js';
import { recordTaskFailure } from './task-failure.js';

export class TaskStore extends EventEmitter {
  private static instance: TaskStore | null = null;
  /** 任务主存储 Map: taskId -> TaskRecord */
  private tasks = new Map<string, TaskRecord>();
  /** 项目关联映射: projectId -> Set<taskId> */
  private projectTasks = new Map<string, Set<string>>();
  /** 任务活跃执行判定探针（由 TaskDispatcher 注入，避免循环引用） */
  private activeChecker: ((taskId: string) => boolean) | null = null;

  private constructor() {
    super();
    // 允许较多的 SSE 监听者
    this.setMaxListeners(100);
  }

  public setActiveChecker(checker: (taskId: string) => boolean): void {
    this.activeChecker = checker;
  }

  public static getInstance(): TaskStore {
    if (!this.instance) {
      this.instance = new TaskStore();
    }
    return this.instance;
  }

  /**
   * 保存或更新任务
   */
  public saveTask(task: TaskRecord): void {
    // 刚性自愈防线：保存任务前必须确保该项目的历史任务账本已完全载入内存，防止直接覆盖抹杀历史任务
    this.ensureProjectLoaded(task.projectId);

    const previous = this.tasks.get(task.taskId);
    const hadProject = this.projectTasks.has(task.projectId);
    this.tasks.set(task.taskId, { ...task });

    if (!this.projectTasks.has(task.projectId)) {
      this.projectTasks.set(task.projectId, new Set());
    }
    this.projectTasks.get(task.projectId)!.add(task.taskId);

    // 持久化到项目目录
    try {
      this.persistProjectTasks(task.projectId);
    } catch (error) {
      if (previous) this.tasks.set(task.taskId, previous);
      else {
        this.tasks.delete(task.taskId);
        this.projectTasks.get(task.projectId)?.delete(task.taskId);
      }
      if (!hadProject) this.projectTasks.delete(task.projectId);
      throw error;
    }

    // 触发事件通知
    this.emitTaskEvent(task);
  }

  private emitTaskEvent(task: TaskRecord): void {
    const payload: TaskEventPayload = {
      taskId: task.taskId,
      projectId: task.projectId,
      toolName: task.toolName,
      status: task.status,
      input: task.input,
      progress: task.progress,
      output: task.output,
      error: task.error,
      failureType: task.failureType,
      lastFailure: task.lastFailure,
      retryCount: task.retryCount,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      durationMs: task.durationMs,
      timestamp: Date.now(),
    };
    this.emit('task_event', payload);
  }

  /**
   * 获取单个任务
   */
  public getTask(taskId: string): TaskRecord | undefined {
    const cached = this.tasks.get(taskId);
    if (cached) return cached;

    // 任务详情接口也必须支持服务重启后的按 ID 查询，不能依赖先访问项目列表触发水合。
    for (const projectId of this.findProjectIds()) {
      this.ensureProjectLoaded(projectId);
      const restored = this.tasks.get(taskId);
      if (restored) return restored;
    }
    return undefined;
  }

  public getLatestTask(taskId: string): TaskRecord | undefined {
    let current = this.getTask(taskId);
    if (!current) return undefined;
    const tasks = this.getTasksByProject(current.projectId);
    const visited = new Set<string>();
    while (!visited.has(current.taskId)) {
      visited.add(current.taskId);
      const replacement = tasks.find((task) => task.replacesTaskId === current!.taskId);
      if (!replacement) break;
      current = replacement;
    }
    return current;
  }

  public findByIdempotencyKey(projectId: string, idempotencyKey: string): TaskRecord | undefined {
    if (!idempotencyKey) return undefined;
    return this.getTasksByProject(projectId).find((task) => task.idempotencyKey === idempotencyKey);
  }

  public listRestartRecoverableTasks(): TaskRecord[] {
    const result: TaskRecord[] = [];
    for (const projectId of this.findProjectIds()) {
      for (const task of this.getTasksByProject(projectId)) {
        if (task.recovery === 'restart' && (task.recoveryAttempts || 0) < 1) result.push(task);
      }
    }
    return result;
  }

  private findProjectIds(): string[] {
    try {
      return fs
        .readdirSync(config.paths.projects, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  /**
   * 获取项目下的所有任务（按时间倒序排列）
   */
  public getTasksByProject(projectId: string): TaskRecord[] {
    // 先检查是否需要从磁盘预加载
    this.ensureProjectLoaded(projectId);

    const taskIds = this.projectTasks.get(projectId);
    if (!taskIds || taskIds.size === 0) return [];

    const list: TaskRecord[] = [];
    const reclaimedTasks: TaskRecord[] = [];
    for (const id of taskIds) {
      const t = this.tasks.get(id);
      if (t) {
        // 自愈门禁：若状态为 running/pending，但活跃调度器中无此任务且创建已超 30s，说明进程上下文丢失，自动收敛为 failed
        if (
          (t.status === 'running' || t.status === 'pending') &&
          this.activeChecker &&
          !this.activeChecker(t.taskId) &&
          Date.now() - t.createdAt > 30000
        ) {
          t.status = 'failed';
          recordTaskFailure(t, '执行线程丢失或服务已重启，请重新触发渲染', 'system_interrupted');
          t.completedAt = Date.now();
          if (t.startedAt) t.durationMs = t.completedAt - t.startedAt;
          reclaimedTasks.push(t);
        }
        list.push(t);
      }
    }
    if (reclaimedTasks.length > 0) {
      this.persistProjectTasks(projectId);
      for (const task of reclaimedTasks) {
        this.emitTaskEvent(task);
      }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 监听任务事件（用于 SSE）
   * @returns 取消监听的函数
   */
  public onTaskEvent(listener: TaskEventListener): () => void {
    this.on('task_event', listener);
    return () => {
      this.off('task_event', listener);
    };
  }

  /**
   * 首次访问某项目时，从本地磁盘 tasks.json 恢复历史任务
   * 内置启动期僵尸任务自动回收机制 (Zombie Task Reclamation)
   */
  private ensureProjectLoaded(projectId: string): void {
    if (this.projectTasks.has(projectId)) return;
    const filePath = path.join(getProjectDir(projectId), 'tasks.json');
    const raw = fs.existsSync(filePath) ? safeReadJsonSync<TaskRecord[]>(filePath) : [];
    if (!Array.isArray(raw)) throw new Error(`任务账本损坏: ${filePath}`);
    const taskIds = new Set<string>();
    let hasZombieCleaned = false;
    for (const item of raw) {
      if (!item?.taskId) continue;
      // 进程退出前未完结的任务在首次加载时收敛为失败。
      if (item.status === 'running' || item.status === 'pending') {
        item.status = 'failed';
        recordTaskFailure(item, '服务重启中断，任务已终止，可重新触发渲染', 'system_interrupted');
        item.recovery = 'restart';
        item.recoveryAttempts = item.recoveryAttempts || 0;
        item.completedAt = item.completedAt || Date.now();
        if (item.startedAt) item.durationMs = item.completedAt - item.startedAt;
        hasZombieCleaned = true;
      }
      this.tasks.set(item.taskId, item);
      taskIds.add(item.taskId);
    }
    this.projectTasks.set(projectId, taskIds);
    if (hasZombieCleaned) this.persistProjectTasks(projectId);
  }

  /**
   * 将某项目的任务列表原子写盘
   */
  private persistProjectTasks(projectId: string): void {
    const taskIds = this.projectTasks.get(projectId);
    if (!taskIds) return;

    const list: TaskRecord[] = [];
    for (const id of taskIds) {
      const t = this.tasks.get(id);
      if (t) list.push(t);
    }

    const filePath = path.join(getProjectDir(projectId), 'tasks.json');
    atomicWriteJsonSync(filePath, list);
  }

  /**
   * 仅用于单测重置
   */
  public _resetForTest(): void {
    this.tasks.clear();
    this.projectTasks.clear();
    this.removeAllListeners();
  }
}

export const taskStore = TaskStore.getInstance();
