/**
 * llm/LLMService.ts
 * 大语言模型统一抽象接口 (Vercel AI SDK SSOT)
 */

export interface LLMStreamToolCall {
  toolCallId: string;
  toolName: string;
  args: any;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  /** 单次调用超时毫秒数（缺省用 config.llm.timeoutMs，当前 300000） */
  timeoutMs?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  stage?: string;
  projectId?: string;
  abortSignal?: AbortSignal;
  onThought?: (thought: string) => Promise<void> | void;
  onToolCall?: (toolCall: LLMStreamToolCall) => Promise<void> | void;
  tools?: Record<string, any>;
  [key: string]: any;
}

export interface LLMService {
  generateText(prompt: string, systemPrompt?: string, options?: LLMOptions): Promise<string>;
  generateObject<T>(prompt: string, schema: any, systemPrompt?: string, options?: LLMOptions): Promise<T>;
  streamObject?<T>(
    prompt: string,
    schema: any,
    systemPrompt?: string,
    onChunk?: (chunk: { type: 'reply' | 'thought'; text: string }) => void,
    options?: LLMOptions
  ): Promise<T>;
  streamText?(
    prompt: string,
    systemPrompt?: string,
    onChunk?: (chunk: string) => void,
    options?: LLMOptions
  ): Promise<string>;
  generateTextWithImages?(prompt: string, images: string[], systemPrompt?: string, options?: LLMOptions): Promise<string>;
  generateMultiTurn?(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: LLMOptions
  ): Promise<string>;
  generateMultiTurnStream?(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    onToken: (token: string) => Promise<void> | void,
    options?: LLMOptions
  ): Promise<string>;
  hasVisionCapability?(): boolean;
}
