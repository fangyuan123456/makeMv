/**
 * llm/RealLLMService.ts
 * 生产级大模型驱动类 (基于 Vercel AI SDK 构建，原生 Tool Calling 与结构化输出)
 */

import { createOpenAI } from '@ai-sdk/openai';
import {
  generateText as aiGenerateText,
  generateObject as aiGenerateObject,
  streamText as aiStreamText,
  jsonSchema,
} from 'ai';
import { LLMService, LLMOptions } from './LLMService.js';
import { JsonSanitizer } from '../utils/JsonSanitizer.js';
import { BrandRouter, ResolvedEndpoint } from './BrandRouter.js';
import { ModelPricingRegistry } from './telemetry/ModelPricing.js';
import type { LLMUsageRecord } from './telemetry/types.js';
import { trace } from '../utils/trace.js';

export class RealLLMService implements LLMService {
  public readonly modelName: string;
  public readonly endpoint: ResolvedEndpoint;
  public onUsageListener?: (record: LLMUsageRecord) => void;
  private modelInstance: any;

  constructor(customModelId?: string) {
    this.endpoint = BrandRouter.resolve(customModelId);
    this.modelName = this.endpoint.model;

    const presetDesc = this.endpoint.presetName ? ` [${this.endpoint.presetName}]` : '';
    console.log(
      `[RealLLMService] 🚀 激活 Vercel AI SDK 通道: 品牌 [${this.endpoint.brand}], 模型 [${this.endpoint.model}]${presetDesc}, 端点 [${this.endpoint.baseURL}]`
    );

    const customFetch = RealLLMService.createDynamicFetch();

    const openai = createOpenAI({
      baseURL: this.endpoint.baseURL,
      apiKey: this.endpoint.apiKey,
      fetch: customFetch,
    });

    this.modelInstance = openai.chat(this.modelName);
  }

  /**
   * 构造具备动态参数穿透能力的自定义 Fetch 拦截器 (解决 AI SDK 默认不透传部分大模型特定思考流参数的问题)
   */
  private static createDynamicFetch(): typeof globalThis.fetch {
    return async (input: any, init?: any): Promise<Response> => {
      if (init && init.body && typeof init.body === 'string') {
        try {
          const headers = (init.headers as Record<string, string>) || {};
          const isDisableThinking = headers['x-disable-thinking'] === 'true';
          const isEnableThinking = headers['x-disable-thinking'] === 'false';
          const thinkingBudgetHeader = headers['x-thinking-budget'];
          const thinkingBudget = thinkingBudgetHeader ? parseInt(thinkingBudgetHeader, 10) : undefined;

          const bodyObj = JSON.parse(init.body);

          if (isDisableThinking) {
            bodyObj.enable_thinking = false;
            bodyObj.thinking = { type: 'disabled' };
            bodyObj.chat_template_kwargs = { enable_thinking: false };
            bodyObj.thinking_budget = 0;
            bodyObj.reasoning_effort = 'none';
          } else if (isEnableThinking || thinkingBudget) {
            bodyObj.enable_thinking = true;
            if (thinkingBudget) {
              bodyObj.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
              bodyObj.thinking_budget = thinkingBudget;
              bodyObj.chat_template_kwargs = { thinking_budget: thinkingBudget, enable_thinking: true };
              bodyObj.reasoning_effort = thinkingBudget > 2048 ? 'high' : 'medium';
            } else {
              delete bodyObj.thinking;
              delete bodyObj.chat_template_kwargs;
              bodyObj.reasoning_effort = 'medium';
            }
          }

          init.body = JSON.stringify(bodyObj);

          // 清理自定义透传 Header，杜绝外网协议污染
          if (init.headers && typeof init.headers === 'object') {
            if ('x-disable-thinking' in (init.headers as any)) {
              delete (init.headers as any)['x-disable-thinking'];
            }
            if ('x-thinking-budget' in (init.headers as any)) {
              delete (init.headers as any)['x-thinking-budget'];
            }
          }
        } catch {
          // 忽略非 JSON 请求体解析异常
        }
      }
      return fetch(input, init);
    };
  }

  public hasVisionCapability(): boolean {
    if (process.env.SKIP_VISUAL_CHECK === 'true') return false;
    return /vl|vision|4o|gpt-4|gemini|claude-3|qwen.*vl/i.test(this.modelName);
  }

  private dispatchUsage(
    usageObj: any,
    stage?: string,
    durationMs?: number,
    customCallback?: (rec: LLMUsageRecord) => void,
    projectId?: string
  ): void {
    if (!usageObj) return;
    const promptTokens = usageObj.promptTokens ?? usageObj.prompt_tokens ?? 0;
    const completionTokens = usageObj.completionTokens ?? usageObj.completion_tokens ?? 0;
    const totalTokens = usageObj.totalTokens ?? usageObj.total_tokens ?? (promptTokens + completionTokens);

    const { cost, currency } = ModelPricingRegistry.calculateCost(promptTokens, completionTokens, this.modelName);

    const record: LLMUsageRecord = {
      model: this.modelName,
      stage: stage || 'general',
      promptTokens,
      completionTokens,
      totalTokens,
      durationMs,
      cost,
      currency,
      timestamp: Date.now(),
    };

    try {
      this.onUsageListener?.(record);
      customCallback?.(record);

      // 🌟 算力与花费持久化追溯打点 (Trace SSOT)
      if (projectId) {
        trace(projectId, 'llm.usage', record);
      }
    } catch (err) {
      console.warn('[RealLLMService] 旁路遥测通知异常 (已安全降级):', err);
    }
  }

  public async generateText(prompt: string, systemPrompt?: string, options?: LLMOptions): Promise<string> {
    const startTime = Date.now();
    try {
      const result = await aiGenerateText({
        model: this.modelInstance,
        system: systemPrompt,
        prompt,
        temperature: options?.temperature ?? 0.3,
        abortSignal: options?.abortSignal,
      });

      const duration = Date.now() - startTime;
      this.dispatchUsage(result.usage, options?.stage, duration, options?.onUsage, options?.projectId);

      return result.text;
    } catch (err: any) {
      console.error(`[RealLLMService] generateText 失败 [${this.modelName}]:`, err.message || err);
      throw err;
    }
  }

  public async generateMultiTurn(
    systemPrompt: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: LLMOptions
  ): Promise<string> {
    const startTime = Date.now();
    try {
      const formattedMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const result = await aiGenerateText({
        model: this.modelInstance,
        system: systemPrompt,
        messages: formattedMessages,
        temperature: options?.temperature ?? 0.7,
        abortSignal: options?.abortSignal,
      });

      const duration = Date.now() - startTime;
      this.dispatchUsage(result.usage, options?.stage, duration, options?.onUsage, options?.projectId);

      return result.text;
    } catch (err: any) {
      console.error(`[RealLLMService] generateMultiTurn 失败 [${this.modelName}]:`, err.message || err);
      throw err;
    }
  }

  public async generateMultiTurnStream(
    systemPrompt: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    onToken: (token: string) => Promise<void> | void,
    options?: LLMOptions
  ): Promise<string> {
    const startTime = Date.now();
    try {
      const formattedMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const result = await aiStreamText({
        model: this.modelInstance,
        system: systemPrompt,
        messages: formattedMessages,
        temperature: options?.temperature ?? 0.7,
        abortSignal: options?.abortSignal,
        tools: options?.tools,
      });

      let fullText = '';
      for await (const part of result.fullStream) {
        if (options?.abortSignal?.aborted) {
          throw new Error('LLM Stream aborted by user');
        }

        if (part.type === 'text-delta') {
          fullText += part.text;
          await onToken(part.text);
        } else if (part.type === 'reasoning-delta') {
          if (options?.onThought) {
            await options.onThought(part.text);
          }
        } else if (part.type === 'tool-call') {
          if (options?.onToolCall) {
            const toolCallInput = (part as any).input ?? (part as any).args;
            await options.onToolCall({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: toolCallInput,
            });
          }
        }
      }

      const duration = Date.now() - startTime;
      let usage: any;
      try {
        usage = await result.usage;
      } catch {
        usage = undefined;
      }
      this.dispatchUsage(usage, options?.stage, duration, options?.onUsage, options?.projectId);

      return fullText;
    } catch (err: any) {
      console.error(`[RealLLMService] generateMultiTurnStream 失败 [${this.modelName}]:`, err.message || err);
      throw err;
    }
  }

  public async generateTextWithImages(
    prompt: string,
    images: string[],
    systemPrompt?: string,
    options?: LLMOptions
  ): Promise<string> {
    if (!this.hasVisionCapability()) {
      console.warn(
        `[RealLLMService] ⚠️ 显式警告：当前配置模型 [${this.modelName}] 未声明多模态 Vision 视觉能力，图像/视频质检将退化或可能被上游 API 拒绝！建议选用 Qwen-VL / GPT-4o / Gemini 等具备原生视觉的大模型。`
      );
    }
    const startTime = Date.now();
    try {
      const contentParts: any[] = [{ type: 'text', text: prompt }];

      for (const img of images) {
        const imageUrl = img.startsWith('http') || img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
        contentParts.push({
          type: 'image',
          image: imageUrl,
        });
      }

      const result = await aiGenerateText({
        model: this.modelInstance,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentParts }],
        temperature: options?.temperature ?? 0.2,
        abortSignal: options?.abortSignal,
      });

      const duration = Date.now() - startTime;
      this.dispatchUsage(result.usage, options?.stage || 'vision', duration, options?.onUsage, options?.projectId);

      return result.text;
    } catch (err: any) {
      console.error(`[RealLLMService] generateTextWithImages 失败 [${this.modelName}]:`, err.message || err);
      throw err;
    }
  }

  /**
   * 🌟 原生结构化输出 (Vercel AI SDK generateObject，内部处理兼容容错，杜绝防守性废话)
   */
  public async generateObject<T>(
    prompt: string,
    schema: any,
    systemPrompt?: string,
    options?: LLMOptions
  ): Promise<T> {
    const startTime = Date.now();
    try {
      const zodOrJsonSchema =
        schema && typeof schema === 'object' && ('safeParse' in schema || '_def' in schema)
          ? schema
          : jsonSchema(schema);

      const result = await aiGenerateObject({
        model: this.modelInstance,
        schema: zodOrJsonSchema,
        system: systemPrompt,
        prompt,
        temperature: options?.temperature ?? 0.2,
        abortSignal: options?.abortSignal,
      });

      const duration = Date.now() - startTime;
      this.dispatchUsage(result.usage, options?.stage, duration, options?.onUsage, options?.projectId);

      return result.object as T;
    } catch (err: any) {
      console.warn(`[RealLLMService] 原生 generateObject 解析异常，执行兼容容错:`, err.message || err);
      const jsonPrompt = `${prompt}\n\n请按以下数据模式输出纯 JSON：\n${typeof schema === 'string' ? schema : JSON.stringify(schema, null, 2)}`;
      const fallbackText = await this.generateText(jsonPrompt, systemPrompt, options);
      const parsedObj = JsonSanitizer.extractJsonFromText<any>(fallbackText);
      return JsonSanitizer.sanitizeAndNormalize<T>(parsedObj, schema);
    }
  }
}
