/**
 * chat/memory/types.ts
 * 双轨记忆管理器类型契约 (Memory Engine SSOT)
 */

import type { ChatMessage, ScratchpadMemory } from '../session/types.js';

export interface MemoryConfig {
  /** 滑动窗口保留的最大活跃消息条数 (默认 6 条，约 3 轮对话) */
  windowSize: number;
  /** 触发全局备忘录异步重新浓缩提炼的新消息间隔 (默认 4 条) */
  summarizeInterval: number;
}

export interface AssembledContext {
  systemPromptWithScratchpad: string;
  slidingWindowMessages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>;
  scratchpad: ScratchpadMemory;
}
