/**
 * project-store/TaskStore.ts
 * 任务持久化仓库 (Task Store SSOT)
 *
 * 单一职责：
 * 任务（生成 / 修改 / 复核）是唯一的状态载体，独立落盘为 tasks.json；
 * 对话消息、前端视图、项目看板一律只引用 taskId，不再各自维护状态副本。
 *
 * 兼容：
 * 老工程只有 proposals.json 时，首次读取自动迁移为 Task（不改动原文件，双写读取去重）。
 */

import fs from 'fs';
import path from 'path';
import { config } from '../utils/config.js';
import { atomicWriteJsonSync } from '../utils/index.js';
import type {
  ActionProposal,
  ActionProposalStatus,
  Task,
  TaskStatus,
} from '../types/index.js';
import { deriveTaskIntent } from '../types/task.js';

/** 旧提案状态 → 任务状态 */
function mapLegacyStatus(status: ActionProposalStatus): TaskStatus {
  switch (status) {
    case 'pending':
      return 'proposed';
    case 'running':
      return 'running';
    case 'executed':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'dismissed':
      return 'cancelled';
    default:
      return 'proposed';
  }
}

/** 旧提案对象 → 任务对象（只做字段搬运，不猜测业务） */
export function taskFromLegacyProposal(proposal: ActionProposal): Task {
  return {
    taskId: proposal.actionId,
    projectId: proposal.projectId || '',
    sessionId: proposal.sessionId,
    intent: deriveTaskIntent(proposal.actionType, proposal.skill),
    skill: proposal.skill,
    actionType: proposal.actionType,
    title: proposal.label,
    description: proposal.description,
    status: mapLegacyStatus(proposal.status),
    stages: proposal.affectedSteps || (proposal.skill ? [proposal.skill] : []),
    approval: {
      required: true,
      approvedAt: proposal.startedAt,
    },
    payload: proposal.payload,
    progress: proposal.progress
      ? {
          current: proposal.progress.current,
          total: proposal.progress.total,
          percent: proposal.progress.percent,
          note: proposal.lastMessage,
        }
      : undefined,
    artifacts: [],
    resultSummary: proposal.resultSummary,
    error: proposal.error,
    isGateIntercept: proposal.isGateIntercept,
    createdAt: proposal.createdAt || new Date().toISOString(),
    startedAt: proposal.startedAt,
    finishedAt: proposal.executedAt || proposal.failedAt,
  };
}

export class TaskStore {
  private static instance?: TaskStore;
  private cache = new Map<string, Map<string, Task>>();

  public static getInstance(): TaskStore {
    if (!TaskStore.instance) {
      TaskStore.instance = new TaskStore();
    }
    return TaskStore.instance;
  }

  public static setInstance(store: TaskStore): void {
    TaskStore.instance = store;
  }

  private validateProjectId(projectId: string): void {
    if (!projectId || typeof projectId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(projectId)) {
      throw new Error(`[TaskStore] 非法的 projectId: "${projectId}"，必须仅包含字母、数字、下划线或连字符`);
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(projectId.trim())) {
      throw new Error(`[TaskStore] 非法的 projectId: "${projectId}"，属于操作系统保留设备名称`);
    }
  }

  private getProjectDir(projectId: string): string {
    this.validateProjectId(projectId);
    const baseProjectsDir = path.resolve(config.paths.projects);
    const dir = path.resolve(baseProjectsDir, projectId);
    if (!dir.startsWith(baseProjectsDir + path.sep)) {
      throw new Error(`[TaskStore] 非法项目路径穿越访问: ${projectId}`);
    }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private getTasksFile(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'tasks.json');
  }

  private loadTasks(projectId: string): Map<string, Task> {
    this.validateProjectId(projectId);
    if (this.cache.has(projectId)) {
      return this.cache.get(projectId)!;
    }

    const map = new Map<string, Task>();
    const file = this.getTasksFile(projectId);

    if (fs.existsSync(file)) {
      try {
        const list = JSON.parse(fs.readFileSync(file, 'utf-8')) as Task[];
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item?.taskId) map.set(item.taskId, item);
          }
        }
      } catch (err) {
        console.warn(`[TaskStore] 加载任务持久化文件失败: ${file}`, err);
      }
    }

    // 旧数据兼容：proposals.json 迁移（内存态合并，tasks.json 优先）
    const legacyFile = path.join(this.getProjectDir(projectId), 'proposals.json');
    if (fs.existsSync(legacyFile)) {
      try {
        const list = JSON.parse(fs.readFileSync(legacyFile, 'utf-8')) as ActionProposal[];
        if (Array.isArray(list)) {
          for (const proposal of list) {
            if (proposal?.actionId && !map.has(proposal.actionId)) {
              map.set(proposal.actionId, taskFromLegacyProposal(proposal));
            }
          }
        }
      } catch (err) {
        console.warn(`[TaskStore] 迁移旧提案数据失败: ${legacyFile}`, err);
      }
    }

    this.cache.set(projectId, map);
    return map;
  }

  /** 滚动裁剪终态任务，pending/running 永不裁剪 */
  private pruneTerminalTasks(map: Map<string, Task>, maxTerminal = 60): void {
    const terminal: Array<{ id: string; time: number }> = [];
    for (const [id, task] of map.entries()) {
      if (task.status === 'proposed' || task.status === 'queued' || task.status === 'running') continue;
      const timeStr = task.finishedAt || task.createdAt;
      terminal.push({ id, time: timeStr ? new Date(timeStr).getTime() : 0 });
    }
    if (terminal.length > maxTerminal) {
      terminal.sort((a, b) => a.time - b.time);
      for (let i = 0; i < terminal.length - maxTerminal; i++) {
        map.delete(terminal[i].id);
      }
    }
  }

  private persist(projectId: string): void {
    const map = this.cache.get(projectId);
    if (!map) return;
    this.pruneTerminalTasks(map);
    try {
      atomicWriteJsonSync(this.getTasksFile(projectId), Array.from(map.values()));
    } catch (err) {
      console.error(`[TaskStore] 持久化任务失败: ${projectId}`, err);
      throw err;
    }
  }

  /** 新建或整体覆盖任务 */
  public saveTask(projectId: string, task: Task): void {
    this.validateProjectId(projectId);
    if (!task?.taskId) {
      throw new Error('[TaskStore] saveTask 失败: task.taskId 必须为非空有效字符串');
    }
    const map = this.loadTasks(projectId);
    const prev = map.get(task.taskId);
    map.set(task.taskId, task);
    try {
      this.persist(projectId);
    } catch (err) {
      if (prev === undefined) map.delete(task.taskId);
      else map.set(task.taskId, prev);
      throw err;
    }
  }

  public getTask(projectId: string, taskId: string): Task | undefined {
    this.validateProjectId(projectId);
    this.cache.delete(projectId); // 强制穿透读取最新落盘数据
    return this.loadTasks(projectId).get(taskId);
  }

  public listTasks(
    projectId: string,
    filter?: { status?: TaskStatus | TaskStatus[]; sessionId?: string; skill?: string }
  ): Task[] {
    this.validateProjectId(projectId);
    this.cache.delete(projectId);
    let list = Array.from(this.loadTasks(projectId).values());
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      list = list.filter((t) => statuses.includes(t.status));
    }
    if (filter?.sessionId) list = list.filter((t) => t.sessionId === filter.sessionId);
    if (filter?.skill) list = list.filter((t) => t.skill === filter.skill);
    return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  /** 局部更新（浅合并 + 嵌套 approval/progress 合并） */
  public patchTask(projectId: string, taskId: string, patch: Partial<Task>): Task | undefined {
    const map = this.loadTasks(projectId);
    const existing = map.get(taskId);
    if (!existing) return undefined;

    const next: Task = {
      ...existing,
      ...patch,
      approval: { ...existing.approval, ...(patch.approval || {}) },
      progress: patch.progress ? { ...patch.progress } : existing.progress,
      artifacts: patch.artifacts ?? existing.artifacts,
    };
    map.set(taskId, next);
    this.persist(projectId);
    return next;
  }

  /**
   * 失败重试复位：清空上一轮的全部运行痕迹，只保留任务身份与意图。
   *
   * 为什么不复用 patchTask：patchTask 的合并规则用 `undefined` 表示「本字段不改」，
   * 因此无法表达「清空」；而重试必须真正清掉 progress / artifacts / error / 结论与时间戳，
   * 否则重试成功后气泡会混入上一轮的进度百分比和旧产物 chips。
   */
  public resetForRetry(projectId: string, taskId: string): Task | undefined {
    const map = this.loadTasks(projectId);
    const existing = map.get(taskId);
    if (!existing) return undefined;

    const next: Task = {
      ...existing,
      status: 'queued',
      startedAt: undefined,
      finishedAt: undefined,
      progress: undefined,
      artifacts: [],
      resultSummary: undefined,
      error: undefined,
    };
    map.set(taskId, next);
    this.persist(projectId);
    return next;
  }

  /** 状态流转（自动补齐时间戳） */
  public setStatus(
    projectId: string,
    taskId: string,
    status: TaskStatus,
    extra?: Partial<Task>
  ): Task | undefined {
    const now = new Date().toISOString();
    const patch: Partial<Task> = { ...(extra || {}), status };
    if (status === 'running' && !patch.startedAt) patch.startedAt = now;
    if ((status === 'succeeded' || status === 'failed' || status === 'cancelled') && !patch.finishedAt) {
      patch.finishedAt = now;
    }
    return this.patchTask(projectId, taskId, patch);
  }

  /** 批准执行：记录审批时间，交给引擎推进 running */
  public approveTask(projectId: string, taskId: string): Task | undefined {
    return this.patchTask(projectId, taskId, {
      approval: { required: true, approvedAt: new Date().toISOString() },
    });
  }

  /** 驳回 / 语义取消：只允许仍在未开始态的任务 */
  public cancelTask(projectId: string, taskId: string, reason?: string): Task | undefined {
    const task = this.getTask(projectId, taskId);
    if (!task) return undefined;
    if (task.status !== 'proposed' && task.status !== 'queued') {
      throw Object.assign(new Error(`[TaskStore] 任务处于 [${task.status}]，不可取消`), { statusCode: 409 });
    }
    return this.setStatus(projectId, taskId, 'cancelled', reason ? { error: reason } : undefined);
  }

  /** 门禁自愈：某工序重新生成后，解除该工序遗留的待审复核任务 */
  public cancelGateTasksForStage(projectId: string, stage: string, reason?: string): number {
    const map = this.loadTasks(projectId);
    let count = 0;
    for (const task of map.values()) {
      if (task.status !== 'proposed') continue;
      const isGate =
        Boolean(task.isGateIntercept) ||
        task.actionType === 'CRITIC_DEBATE' ||
        task.skill === 'critic-review';
      if (isGate && task.payload?.stage === stage) {
        task.status = 'cancelled';
        task.finishedAt = new Date().toISOString();
        if (reason) task.error = reason;
        count++;
      }
    }
    if (count > 0) this.persist(projectId);
    return count;
  }

  /** 测试/回滚用：丢弃内存缓存 */
  public invalidate(projectId?: string): void {
    if (projectId) this.cache.delete(projectId);
    else this.cache.clear();
  }
}
