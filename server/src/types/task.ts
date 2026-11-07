/**
 * types/task.ts
 * 任务领域契约 (Task Domain SSOT)
 *
 * 设计铁律：
 * 1. 一次「生成 / 修改 / 复核」= 一个 Task，taskId 是唯一身份，状态与产物只归属 Task；
 * 2. 对话消息只保存 taskId 引用，绝不内嵌状态快照（消灭多处副本导致的漂移）；
 * 3. 未开始 = proposed(待确认) / queued(已批准未执行)，执行中 = running，
 *    已结束 = succeeded | failed | cancelled；
 * 4. 产物以 artifacts 链接形式挂在 Task 上，project.stageArtifacts 仅作为管线读模型保留。
 */

export type TaskIntent = 'generate' | 'revise' | 'review';

export type TaskStatus = 'proposed' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface TaskProgress {
  current: number;
  total: number;
  percent: number;
  note?: string; // 当前阶段可读描述
}

export interface TaskArtifact {
  stage: string; // 对应 WorkflowStage 键位
  kind?: string; // stage-artifact | media | file
  label?: string;
  url?: string; // 可取回该产物的 HTTP 链接
  path?: string; // 本地落盘相对路径
  summary?: string;
  createdAt?: string;
}

export interface TaskApproval {
  required: boolean;
  approvedAt?: string;
}

export interface Task {
  taskId: string;
  projectId: string;
  sessionId?: string;
  intent: TaskIntent;
  skill?: string; // 执行体标识（workflow key）
  actionType?: string; // 兼容既有执行体分流口径 (PROCEED_STAGE / TARGETED_REVISE ...)
  title: string;
  description?: string;
  status: TaskStatus;
  stages: string[]; // 本任务涉及的工序（原 affectedSteps）
  approval: TaskApproval;
  payload?: Record<string, any>;
  progress?: TaskProgress;
  artifacts: TaskArtifact[];
  resultSummary?: string;
  error?: string;
  isGateIntercept?: boolean;
  parentTaskId?: string; // 级联重推 / 微调溯源
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/** 终态判定：任务不会再发生变化 */
export function isTaskTerminal(status: TaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

/** 未结束（可用于「待办 / 执行中」两类渲染） */
export function isTaskOpen(status: TaskStatus): boolean {
  return !isTaskTerminal(status);
}

/** 由 actionType 派生意图：generate(生成) / revise(微调) / review(复核) */
export function deriveTaskIntent(actionType?: string, skill?: string): TaskIntent {
  const type = (actionType || '').toUpperCase();
  if (type.includes('REVISE') || type.includes('MODIFY')) return 'revise';
  if (type.includes('CRITIC') || type.includes('REVIEW') || (skill || '').includes('critic')) return 'review';
  return 'generate';
}
