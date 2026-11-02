/**
 * agents/director/types.ts
 * AI 导演副手领域契约与类型定义 (SSOT)
 */

import type { ChatMessage, ActionProposal } from '../../chat/session/types.js';
import type { ReviewReport } from '../reviewer/types.js';

export interface ChatStreamCallbacks {
  onToken?: (token: string) => Promise<void> | void;
  onThought?: (thought: string) => Promise<void> | void;
  onProposal?: (proposal: ActionProposal) => Promise<void> | void;
}

export interface DirectorContext {
  systemPromptWithScratchpad: string;
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentStage: string;
  reviewReport: ReviewReport | null;
}

export interface DirectorChatResult {
  replyMessage: ChatMessage;
  proposal?: ActionProposal;
}

export type DirectorStreamResult = DirectorChatResult;
