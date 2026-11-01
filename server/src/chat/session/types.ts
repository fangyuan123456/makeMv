/**
 * chat/session/types.ts
 * 现代 Agentic 架构会话与消息强类型契约 (Session & Message SSOT)
 */

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallItem {
  id: string;
  name: string;
  args: Record<string, any>;
}

export type ActionProposalStatus = 'pending' | 'executed' | 'dismissed';

export interface ActionProposal {
  actionId: string;
  actionType: string;
  skill?: string; // 🌟 顶层标准技能标识 (SSOT，对应外挂技能包名称如 story-bible, critic-review)
  label: string;
  description?: string;
  status: ActionProposalStatus; // 🌟 生命周期状态机 (pending | executed | dismissed)
  payload?: Record<string, any>;
  executedAt?: string;
  resultSummary?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  thought?: string; // 思考流 (Thought Chain / CoT)
  toolCalls?: ToolCallItem[];
  toolCallId?: string;
  actionProposal?: ActionProposal; // 重型任务操作提案 (前端渲染确认高光卡片)
  createdAt: string;
}

/**
 * 🌟 全局事实备忘录白板 (Scratchpad Memory SSOT)
 * 拒绝废话拼接，永远只保留确立的结论与硬核事实
 */
export interface ScratchpadMemory {
  themeAndStyle?: string; // 题材与视觉影调风格
  logline?: string; // 一句话大纲
  charactersSummary?: string; // 核心主角/反派已确立人设
  storySpine?: string; // 黄金戏剧冲突骨架
  userConstraints: string[]; // 创作者明确的刚性要求/偏好/禁忌
  lastUpdatedAt: string;
}

export interface ChatSession {
  sessionId: string;
  projectId: string;
  title: string;
  currentStage: string;
  scratchpad: ScratchpadMemory;
  createdAt: string;
  updatedAt: string;
}
