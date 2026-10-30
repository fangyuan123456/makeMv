/**
 * agent-runtime/contracts/AgentMessage.ts
 * 智能体间结构化消息定义 (Message Protocol SSOT)
 */

export interface AgentMessage<T = unknown> {
  id: string;
  projectId: string;
  from: string;
  to: string;
  action: string;
  payload: T;
  timestamp: string;
}

export interface AgentResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  durationMs?: number;
}

export type MessageHandler<TInput = any, TOutput = any> = (
  msg: AgentMessage<TInput>,
) => Promise<AgentResponse<TOutput>>;
