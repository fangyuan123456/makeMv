/**
 * task-engine/types.ts
 * 统一任务调度引擎强类型契约 (Task Engine SSOT)
 */

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskProgress {
  current: number;
  total: number;
  message?: string;
  percent?: number;
}

export interface TaskRecord<TInput = any, TOutput = any> {
  taskId: string;
  projectId: string;
  toolName: string;
  idempotencyKey?: string;
  recovery?: 'restart';
  recoveryAttempts?: number;
  status: TaskStatus;
  progress?: TaskProgress;
  input: TInput;
  output?: TOutput;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface TaskEventPayload {
  taskId: string;
  projectId: string;
  toolName: string;
  status: TaskStatus;
  input?: any;
  progress?: TaskProgress;
  output?: any;
  error?: string;
  durationMs?: number;
  timestamp: number;
}

export type TaskEventListener = (event: TaskEventPayload) => void;
