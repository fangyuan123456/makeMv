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
