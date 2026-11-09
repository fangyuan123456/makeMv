/**
 * workflow-engine/types.ts
 * 任务生命周期与工作流契约规范 (Task Lifecycle SSOT)
 */

export type TaskStatus = 'proposed' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface TaskProgress {
  current: number;
  total: number;
  percent: number;
  note: string;
}

export interface Task {
  taskId: string;
  projectId: string;
  workflowKey: string;
  title: string;
  status: TaskStatus;
  progress: TaskProgress;
  requireConfirmation: boolean;
  payload?: any;
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProgressReporter = (percent: number, note: string) => void;
