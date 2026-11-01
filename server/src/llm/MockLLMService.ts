/**
 * llm/MockLLMService.ts
 * 离线高保真大模型模拟服务
 */

import { LLMService, LLMOptions } from './LLMService.js';

export class MockLLMService implements LLMService {
  public hasVisionCapability(): boolean {
    return true;
  }

  public async generateTextWithImages(
    prompt: string,
    images: string[],
    systemPrompt?: string,
    options?: LLMOptions
  ): Promise<string> {
    return JSON.stringify({ passed: true, score: 95, issues: [] });
  }

  public async generateMultiTurn(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: LLMOptions
  ): Promise<string> {
    return JSON.stringify({
      thought: 'Mock execution finished',
      tool: 'finish',
      args: { summary: 'Mock execution completed successfully.' },
    });
  }

  public async generateMultiTurnStream(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    onToken: (token: string) => Promise<void> | void,
    options?: LLMOptions
  ): Promise<string> {
    const text = 'Mock LLM Streamed Response';
    await onToken(text);
    return text;
  }

  public async generateText(prompt: string, systemPrompt?: string, options?: LLMOptions): Promise<string> {
    return JSON.stringify({ success: true, message: 'Mock LLM Response' });
  }

  public async generateObject<T>(
    prompt: string,
    schema: any,
    systemPrompt?: string,
    options?: LLMOptions
  ): Promise<T> {
    return {} as T;
  }
}
