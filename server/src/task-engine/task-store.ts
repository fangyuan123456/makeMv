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
    this.tasks.set(task.taskId, { ...task });

    if (!this.projectTasks.has(task.projectId)) {
      this.projectTasks.set(task.projectId, new Set());
    }
    this.projectTasks.get(task.projectId)!.add(task.taskId);

    // 持久化到项目目录
    this.persistProjectTasks(task.projectId);

    // 触发事件通知
    const payload: TaskEventPayload = {
      taskId: task.taskId,
      projectId: task.projectId,
      toolName: task.toolName,
      status: task.status,
      input: task.input,
      progress: task.progress,
      output: task.output,
      error: task.error,
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
    let hasZombieCleaned = false;
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
          t.error = '执行线程丢失或服务已重启，请重新触发渲染';
          t.completedAt = Date.now();
          if (t.startedAt) t.durationMs = t.completedAt - t.startedAt;
          hasZombieCleaned = true;
        }
        list.push(t);
      }
    }
    if (hasZombieCleaned) {
      this.persistProjectTasks(projectId);
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

    this.projectTasks.set(projectId, new Set());
    let hasZombieCleaned = false;
    try {
      const filePath = path.join(getProjectDir(projectId), 'tasks.json');
      if (fs.existsSync(filePath)) {
        const raw = safeReadJsonSync<TaskRecord[]>(filePath);
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item && item.taskId) {
              // 自动回收僵尸运行态：若任务在磁盘上处于 running 或 pending，但当前为首次自磁盘恢复，说明该任务在上次进程退出前未完结，刚性标记为中断失败
              if (item.status === 'running' || item.status === 'pending') {
                item.status = 'failed';
                item.error = '服务重启中断，任务已终止，可重新触发渲染';
                item.recovery = 'restart';
                item.recoveryAttempts = item.recoveryAttempts || 0;
                item.completedAt = item.completedAt || Date.now();
                if (item.startedAt) {
                  item.durationMs = item.completedAt - item.startedAt;
                }
                hasZombieCleaned = true;
              }
              this.tasks.set(item.taskId, item);
              this.projectTasks.get(projectId)!.add(item.taskId);
            }
          }
        }
      }
      if (hasZombieCleaned) {
        this.persistProjectTasks(projectId);
      }
    } catch {
      // 容错读取，不抛崩
    }
  }

  /**
   * 将某项目的任务列表原子写盘
   */
  private persistProjectTasks(projectId: string): void {
    try {
      const taskIds = this.projectTasks.get(projectId);
      if (!taskIds) return;

      const list: TaskRecord[] = [];
      for (const id of taskIds) {
        const t = this.tasks.get(id);
        if (t) list.push(t);
      }

      const filePath = path.join(getProjectDir(projectId), 'tasks.json');
      atomicWriteJsonSync(filePath, list);
    } catch {
      // 静默写入失败保护
    }
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
