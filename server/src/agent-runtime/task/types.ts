/**
 * agent-runtime/task/types.ts
 * 通用动态可变任务拓扑图（DAG TaskGraph）类型定义 (SSOT)
 * 纯通用技术底座，无业务概念依赖
 */

export const TASK_STATUS = {
  PENDING: 'PENDING',       // 等待前置依赖完成
  READY: 'READY',           // 前置依赖已满足，就绪可执行
  ACTIVE: 'ACTIVE',         // 正在执行
  COMPLETED: 'COMPLETED',   // 执行完成
  FAILED: 'FAILED',         // 失败
  SKIPPED: 'SKIPPED',       // 因上游失败或条件不满足而跳过
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export interface TaskNode<TPayload = Record<string, unknown>> {
  id: string;
  type: string;
  status: TaskStatus;
  dependsOn: string[];
  payload: TPayload;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastError?: string;
}

export interface TaskGraphSnapshot<TPayload = Record<string, unknown>> {
  projectId: string;
  nodes: TaskNode<TPayload>[];
  readyBatch: string[];
  stats: {
    total: number;
    pending: number;
    active: number;
    completed: number;
    failed: number;
    skipped: number;
  };
}

export type TaskExecuteFn<TPayload = any, TResult = any> = (
  node: TaskNode<TPayload>,
) => Promise<TResult>;

export interface TaskGraphRunnerOptions<TPayload = any, TResult = any> {
  concurrency?: number;         // 最大并发执行数，默认 3
  stopOnError?: boolean;        // 遇到不可恢复错误是否立即阻断中止，默认 true
  onTaskStart?: (node: TaskNode<TPayload>) => void;
  onTaskSuccess?: (node: TaskNode<TPayload>, result: TResult) => void;
  onTaskFail?: (node: TaskNode<TPayload>, error: any) => void;
}
