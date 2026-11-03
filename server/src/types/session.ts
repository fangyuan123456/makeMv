/**
 * types/session.ts
 * 现代 Agentic 架构会话、消息与人在回路提案强类型契约 (Session & Message Domain SSOT)
 */

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallItem {
  id: string;
  name: string;
  args: Record<string, any>;
}

export type ActionProposalStatus = 'pending' | 'executed' | 'dismissed' | 'failed';

export interface ActionProposal {
  actionId: string;
  actionType: string;
  skill?: string; // 顶层标准技能标识 (SSOT，对应外挂技能包名称如 story-bible, critic-review)
  label: string;
  description?: string;
  status: ActionProposalStatus; // 生命周期状态机 (pending | executed | dismissed | failed)
  isGateIntercept?: boolean; // 显式指示该提案是否为审查官门禁拦截自愈卡片 (SSOT)
  payload?: Record<string, any>;
  executedAt?: string;
  failedAt?: string;
  resultSummary?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  thought?: string; // 思考流 (Thought Chain / CoT)
  toolCalls?: ToolCallItem[];
  toolCallId?: string;
  actionProposal?: ActionProposal; // 重型任务操作提案 (前端渲染确认高光卡片)
  isError?: boolean; // 显式标明是否为执行异常占位消息
  isAborted?: boolean; // 显式标明是否为创作者主动中断消息
  createdAt: string;
}

/**
 * 全局事实备忘录白板 (Scratchpad Memory SSOT)
 * 拒绝废话拼接，永远只保留确立的结论与硬核事实
 */
export interface ScratchpadMemory {
  themeAndStyle?: string; // 题材与视觉影调风格
  logline?: string; // 一句话大纲
  charactersSummary?: string; // 核心主角/反派已确立人设
  characterVisualAnchors?: string; // 核心角色视觉定妆锚点 (发型、服装色彩、标志性配饰、定妆照)
  storySpine?: string; // 黄金戏剧冲突骨架
  userConstraints: string[]; // 创作者明确的刚性要求/偏好/禁忌
  cinematographyAndRhythm?: string; // 镜头运动基调、镜头时长与剪辑节奏
  audioAndVoicePreferences?: string; // 角色音色偏好、BGM与拟音质感
  packagingAndInteractiveSpec?: string; // 交互决策机制、分支收束与UI包装规范
  lastUpdatedAt: string;
  lastSummarizedCount?: number;
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
