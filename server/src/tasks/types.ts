/**
 * tasks/types.ts
 * 异步长耗时工序任务领域契约 (Task Engine SSOT)
 */

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'aborted';

export interface TaskEntity<TParams = any, TResult = any> {
  taskId: string;
  projectId: string;
  sessionId?: string;
  skillName: string;
  params: TParams;
  status: TaskStatus;
  progress: number; // 0 - 100
  message: string;
  result?: TResult;
  error?: string;
  errorCode?: string; // 🌟 归一化诊断错误码 (AUTH | RATE_LIMIT | TIMEOUT | CONTENT_FILTER | PARSE | UNKNOWN)
  errorDetail?: string; // 错误诊断原始明细
  failedItems?: Array<{ id: string; reason: string }>; // 批量并发中局部失败的条目
  usage?: { model: string; tokens: number; cost: number; currency: string }; // 任务消耗算力与花费
  partialResult?: any; // 🌟 任务失败时已完成的部分成果保全快照
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CreateTaskOptions {
  projectId: string;
  sessionId?: string;
  skillName: string;
  params?: Record<string, any>;
  actionId?: string;
}
