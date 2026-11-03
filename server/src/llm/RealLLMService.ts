/**
 * llm/RealLLMService.ts
 * 生产级大模型驱动服务 (基于 Vercel AI SDK 构建)
 */

import { createOpenAI } from '@ai-sdk/openai';
import {
  generateText as aiGenerateText,
  generateObject as aiGenerateObject,
} from 'ai';
import type { LLMService, LLMOptions } from './LLMService.js';
import { config } from '../utils/config.js';

export class RealLLMService implements LLMService {
  public readonly modelName: string;
  private modelInstance: any;

  constructor(customModelId?: string) {
    this.modelName = customModelId || config.llm.model || 'qwen-plus';

    const openai = createOpenAI({
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey || 'placeholder-key',
    });

    this.modelInstance = openai.chat(this.modelName);
  }

  public hasVisionCapability(): boolean {
    return true;
  }

  private getEffectiveSignal(customSignal?: AbortSignal, timeoutMs = 90000): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!customSignal) {
      return timeoutSignal;
    }
    // Node.js 20+ 原生支持 AbortSignal.any
    if (typeof (AbortSignal as any).any === 'function') {
      return (AbortSignal as any).any([customSignal, timeoutSignal]);
    }
    return customSignal;
  }

  public async generateText(prompt: string, systemPrompt?: string, options?: LLMOptions): Promise<string> {
    const effectiveSignal = this.getEffectiveSignal(options?.abortSignal);
    const { text } = await aiGenerateText({
      model: this.modelInstance,
      system: systemPrompt,
      prompt,
      temperature: options?.temperature,
      abortSignal: effectiveSignal,
    });
    return text;
  }

  public async generateObject<T>(
    prompt: string,
    schema: any,
    systemPrompt?: string,
    options?: LLMOptions
  ): Promise<T> {
    const effectiveSignal = this.getEffectiveSignal(options?.abortSignal);
    const { object } = await aiGenerateObject({
      model: this.modelInstance,
      schema,
      system: systemPrompt,
      prompt,
      temperature: options?.temperature,
      abortSignal: effectiveSignal,
    });
    return object as T;
  }
}
