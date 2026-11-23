/**
 * task-engine/types.ts
 * 统一任务调度引擎强类型契约 (Task Engine SSOT)
 */

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * 结构化失败类型体系 (SSOT)
 */
export type TaskFailureType =
  | 'llm_contract_error'      // LLM 输出不符合契约/缺失必填/JSON解析失败/语义脱轨
  | 'media_service_error'     // ComfyUI / DashScope / 外部 GPU 算力异常 / 显存溢出 / 规格不符
  | 'system_interrupted'      // 服务重启中断 / 执行线程丢失 / 僵尸任务回收
  | 'transient_network_error' // 网络超时 / 连接重置 / 502 / 504 瞬态网关错误
  | 'system_fault';           // 其他系统未捕获异常

/**
 * 单次失败历史切片记录
 */
export interface TaskFailureRecord {
  timestamp: number;
  type: TaskFailureType;
  error: string;
  attempt: number;
  details?: Record<string, any>;
}

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
  replacesTaskId?: string;
  recovery?: 'restart';
  recoveryAttempts?: number;
  status: TaskStatus;
  progress?: TaskProgress;
  input: TInput;
  output?: TOutput;
  error?: string;
  failureType?: TaskFailureType;
  lastFailure?: TaskFailureRecord;
  retryCount?: number;
  maxRetries?: number;
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
  failureType?: TaskFailureType;
  lastFailure?: TaskFailureRecord;
  retryCount?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  timestamp: number;
}

export type TaskEventListener = (event: TaskEventPayload) => void;
