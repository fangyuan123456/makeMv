/**
 * llm/LLMService.ts
 * 大模型集成服务统一抽象接口
 */

import type { LLMUsageRecord } from './telemetry/types.js';

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  stage?: string;
  onUsage?: (record: LLMUsageRecord) => void;
  abortSignal?: AbortSignal;
}

export interface LLMService {
  generateText(prompt: string, systemPrompt?: string, options?: LLMOptions): Promise<string>;
  generateObject<T>(prompt: string, schema: any, systemPrompt?: string, options?: LLMOptions): Promise<T>;
  generateTextWithImages(prompt: string, images: string[], systemPrompt?: string, options?: LLMOptions): Promise<string>;
  generateMultiTurn(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: LLMOptions
  ): Promise<string>;
  generateMultiTurnStream(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    onToken: (token: string) => Promise<void> | void,
    options?: LLMOptions
  ): Promise<string>;
  hasVisionCapability?(): boolean;
}
