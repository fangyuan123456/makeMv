/**
 * agent-runtime/task/TaskGraph.ts
 * 通用动态可变任务拓扑图（DAG TaskGraph）微内核实现 (SSOT)
 * 纯通用多智能体依赖调度引擎，0 业务依赖
 */

import { randomUUID } from 'crypto';
import {
  TASK_STATUS,
  type TaskNode,
  type TaskStatus,
  type TaskGraphSnapshot,
} from './types.js';

export interface ITaskGraph<TPayload = Record<string, unknown>> {
  readonly projectId: string;
  addTask(type: string, payload: TPayload, dependsOn?: string[], label?: string): string;
  markActive(taskId: string): void;
  markCompleted(taskId: string): void;
  markFailed(taskId: string, error?: string): void;
  incrementRetry(taskId: string): boolean;
  getReadyBatch(): TaskNode<TPayload>[];
  isComplete(): boolean;
  hasFailed(): boolean;
  snapshot(): TaskGraphSnapshot<TPayload>;
  importSnapshot(snapshot: TaskGraphSnapshot<TPayload>): void;
  getTaskById(taskId: string): TaskNode<TPayload> | undefined;
}

export class CyclicDependencyError extends Error {
  constructor(cycle: string[]) {
    super(`检测到循环依赖，禁止执行：${cycle.join(' → ')}`);
    this.name = 'CyclicDependencyError';
  }
}

export class TaskGraph<TPayload = Record<string, unknown>> implements ITaskGraph<TPayload> {
  private nodes = new Map<string, TaskNode<TPayload>>();
  private nameToId = new Map<string, string>();
  private idToName = new Map<string, string>();
  public readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  public addNode(node: TaskNode<TPayload>, label?: string): void {
    this.nodes.set(node.id, node);
    if (label) {
      this.nameToId.set(label, node.id);
      this.idToName.set(node.id, label);
    }
  }

  public importSnapshot(snapshot: TaskGraphSnapshot<TPayload>): void {
    if (!snapshot?.nodes) return;
    for (const node of snapshot.nodes) {
      this.nodes.set(node.id, { ...node });
      const label = ((node.payload as any)?.name as string) || node.id;
      this.nameToId.set(label, node.id);
      this.idToName.set(node.id, label);
    }
  }

  public getIdByName(name: string): string | undefined {
    return this.nameToId.get(name);
  }

  public getTaskById(taskId: string): TaskNode<TPayload> | undefined {
    return this.nodes.get(taskId);
  }

  public registerName(name: string, id: string): void {
    this.nameToId.set(name, id);
    this.idToName.set(id, name);
  }

  public addTask(
    type: string,
    payload: TPayload,
    dependsOnNames: string[] = [],
    label?: string,
  ): string {
    const dependsOn = dependsOnNames.map((name) => {
      const id = this.nameToId.get(name);
      if (!id) throw new Error(`动态插入节点时，依赖 "${name}" 不存在于图中。`);
      return id;
    });

    const node = this.createNode(type, payload, dependsOn);

    if (label) {
      this.registerName(label, node.id);
    }

    this.detectCycle();
    this.refreshReadyState();
    return node.id;
  }

  markActive(nodeId: string): void {
    this.updateStatus(nodeId, TASK_STATUS.ACTIVE);
  }

  markCompleted(nodeId: string): void {
    this.updateStatus(nodeId, TASK_STATUS.COMPLETED);
    this.refreshReadyState();
  }

  markFailed(nodeId: string, error?: string): void {
    const node = this.nodes.get(nodeId);
    if (node && error) {
      node.lastError = error;
    }
    this.updateStatus(nodeId, TASK_STATUS.FAILED);
    this.skipDownstream(nodeId);
  }

  incrementRetry(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    node.retryCount++;
    node.updatedAt = new Date().toISOString();
    if (node.retryCount > node.maxRetries) {
      this.markFailed(nodeId);
      return false;
    }
    this.updateStatus(nodeId, TASK_STATUS.READY);
    return true;
  }

  getNode(nodeId: string): TaskNode<TPayload> | undefined {
    return this.nodes.get(nodeId);
  }

  getReadyBatch(): TaskNode<TPayload>[] {
    return [...this.nodes.values()].filter((n) => n.status === TASK_STATUS.READY);
  }

  getPendingTasks(): TaskNode<TPayload>[] {
    return [...this.nodes.values()].filter(
      (n) => n.status === TASK_STATUS.PENDING || n.status === TASK_STATUS.READY,
    );
  }

  isComplete(): boolean {
    return [...this.nodes.values()].every(
      (n) => n.status === TASK_STATUS.COMPLETED || n.status === TASK_STATUS.SKIPPED || n.status === TASK_STATUS.FAILED,
    );
  }

  hasFailed(): boolean {
    return [...this.nodes.values()].some((n) => n.status === TASK_STATUS.FAILED);
  }

  snapshot(): TaskGraphSnapshot<TPayload> {
    const all = [...this.nodes.values()];
    return {
      projectId: this.projectId,
      nodes: all,
      readyBatch: this.getReadyBatch().map((n) => n.id),
      stats: {
        total: all.length,
        pending: all.filter((n) => n.status === TASK_STATUS.PENDING).length,
        active: all.filter((n) => n.status === TASK_STATUS.ACTIVE).length,
        completed: all.filter((n) => n.status === TASK_STATUS.COMPLETED).length,
        failed: all.filter((n) => n.status === TASK_STATUS.FAILED).length,
        skipped: all.filter((n) => n.status === TASK_STATUS.SKIPPED).length,
      },
    };
  }

  public createNode(
    type: string,
    payload: TPayload,
    dependsOn: string[] = [],
  ): TaskNode<TPayload> {
    const now = new Date().toISOString();
    const node: TaskNode<TPayload> = {
      id: randomUUID(),
      type,
      status: TASK_STATUS.PENDING,
      dependsOn,
      payload,
      retryCount: 0,
      maxRetries: 2,
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  private updateStatus(nodeId: string, status: TaskStatus): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.status = status;
    node.updatedAt = new Date().toISOString();
    if (status === TASK_STATUS.COMPLETED) {
      node.completedAt = node.updatedAt;
    }
  }

  public refreshReadyState(): void {
    for (const node of this.nodes.values()) {
      if (node.status !== TASK_STATUS.PENDING) continue;
      const allDepsDone = node.dependsOn.every((depId) => {
        const dep = this.nodes.get(depId);
        return dep?.status === TASK_STATUS.COMPLETED;
      });
      if (allDepsDone) {
        node.status = TASK_STATUS.READY;
        node.updatedAt = new Date().toISOString();
      }
    }
  }

  private skipDownstream(failedId: string): void {
    for (const node of this.nodes.values()) {
      if (node.status !== TASK_STATUS.PENDING && node.status !== TASK_STATUS.READY) continue;
      if (node.dependsOn.includes(failedId)) {
        node.status = TASK_STATUS.SKIPPED;
        node.updatedAt = new Date().toISOString();
        this.skipDownstream(node.id);
      }
    }
  }

  public detectCycle(): void {
    const inDegree = new Map<string, number>();
    const all = [...this.nodes.keys()];

    for (const node of this.nodes.values()) inDegree.set(node.id, node.dependsOn.length);

    const queue = all.filter((id) => (inDegree.get(id) ?? 0) === 0);
    let visited = 0;

    while (queue.length > 0) {
      const cur = queue.shift()!;
      visited++;
      for (const node of this.nodes.values()) {
        if (!node.dependsOn.includes(cur)) continue;
        const newDegree = (inDegree.get(node.id) ?? 1) - 1;
        inDegree.set(node.id, newDegree);
        if (newDegree === 0) queue.push(node.id);
      }
    }

    if (visited < all.length) {
      const cycleNodes = all
        .filter((id) => (inDegree.get(id) ?? 0) > 0)
        .map((id) => this.idToName.get(id) ?? id);
      throw new CyclicDependencyError(cycleNodes);
    }
  }
}
