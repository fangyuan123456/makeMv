/**
 * agent-runtime/bus/types.ts
 * 智能体运行时实时进度与总线强类型契约 (SSOT)
 */

export interface ProgressPayload {
  projectId: string;
  stage: string;
  detail: string;
  percent: number;
  timestamp: string;
}
