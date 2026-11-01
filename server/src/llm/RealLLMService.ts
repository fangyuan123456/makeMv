/**
 * llm/RealLLMService.ts
 * 生产级大模型驱动类 (接入 BrandRouter 品牌自适应路由与 ModelPricing 遥测)
 */

import OpenAI from 'openai';
import { LLMService, LLMOptions } from './LLMService.js';
import { JsonSanitizer } from '../utils/JsonSanitizer.js';
import { BrandRouter, ResolvedEndpoint } from './BrandRouter.js';
import { ModelPricingRegistry } from './telemetry/ModelPricing.js';
import type { LLMUsageRecord } from './telemetry/types.js';

export class RealLLMService implements LLMService {
  private client: OpenAI;
  public readonly modelName: string;
  public readonly endpoint: ResolvedEndpoint;
  public onUsageListener?: (record: LLMUsageRecord) => void;

  constructor(customModelId?: string) {
    this.endpoint = BrandRouter.resolve(customModelId);
    this.modelName = this.endpoint.model;

    const presetDesc = this.endpoint.presetName ? ` [${this.endpoint.presetName}]` : '';
    console.log(
      `[RealLLMService] 🚀 激活大模型通道: 品牌 [${this.endpoint.brand}], 模型 [${this.endpoint.model}]${presetDesc}, 端点 [${this.endpoint.baseURL}]`
    );

    this.client = new OpenAI({
      apiKey: this.endpoint.apiKey || 'dummy_key',
      baseURL: this.endpoint.baseURL,
    });
  }

  public hasVisionCapability(): boolean {
    if (process.env.SKIP_VISUAL_CHECK === 'true') return false;
    return /vl|vision|4o|gpt-4|gemini|claude-3|qwen.*vl/i.test(this.modelName);
  }

  private dispatchUsage(
    usageObj: any,
    stage?: string,
    durationMs?: number,
    customCallback?: (rec: LLMUsageRecord) => void
  ): void {
    if (!usageObj) return;
    const promptTokens = usageObj.prompt_tokens ?? usageObj.promptTokens ?? 0;
    const completionTokens = usageObj.completion_tokens ?? usageObj.completionTokens ?? 0;
    const totalTokens = usageObj.total_tokens ?? usageObj.totalTokens ?? (promptTokens + completionTokens);

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
    } catch (err) {
      console.warn('[RealLLMService] 旁路遥测通知异常 (已安全降级):', err);
    }
  }

  public async generateText(prompt: string, systemPrompt?: string, options?: LLMOptions): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const maxTokens = options?.maxTokens ?? 16384;
    const temperature = options?.temperature ?? 0.3;
    const startTime = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages,
        temperature,
        max_tokens: maxTokens,
      }, {
        signal: options?.abortSignal,
      });

      const duration = Date.now() - startTime;
      const text = response.choices[0]?.message?.content || '';
      this.dispatchUsage(response.usage, options?.stage, duration, options?.onUsage);

      return text;
    } catch (err: any) {
      console.error(`[RealLLMService] generateText 失败 [${this.modelName}]:`, err.message || err);
      throw err;
    }
  }

  public async generateMultiTurn(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: LLMOptions
  ): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }

    const maxTokens = options?.maxTokens ?? 16384;
    const temperature = options?.temperature ?? 0.3;
    const startTime = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages,
        temperature,
        max_tokens: maxTokens,
      }, {
        signal: options?.abortSignal,
      });

      const duration = Date.now() - startTime;
      const text = response.choices[0]?.message?.content || '';
      this.dispatchUsage(response.usage, options?.stage, duration, options?.onUsage);

      return text;
    } catch (err: any) {
      console.error(`[RealLLMService] generateMultiTurn 失败 [${this.modelName}]:`, err.message || err);
      throw err;
    }
  }

  /**
   * 🌟 真实流式多轮生成 (OpenAI 原生 stream: true，首字极速吐出)
   */
  public async generateMultiTurnStream(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    onToken: (token: string) => Promise<void> | void,
    options?: LLMOptions
  ): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }

    const maxTokens = options?.maxTokens ?? 16384;
    const temperature = options?.temperature ?? 0.3;
    const startTime = Date.now();
    let fullText = '';

    try {
      const stream = await this.client.chat.completions.create({
        model: this.modelName,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }, {
        signal: options?.abortSignal,
      });

      for await (const chunk of stream) {
        if (options?.abortSignal?.aborted) break;
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          await onToken(delta);
        }
      }

      const duration = Date.now() - startTime;
      this.dispatchUsage(undefined, options?.stage, duration, options?.onUsage);

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
    const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: prompt },
    ];

    for (const img of images) {
      const imageUrl = img.startsWith('http') || img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
      contentParts.push({
        type: 'image_url',
        image_url: { url: imageUrl },
      });
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: contentParts });

    const startTime = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages,
        temperature: options?.temperature ?? 0.2,
      }, {
        signal: options?.abortSignal,
      });

      const duration = Date.now() - startTime;
      const text = response.choices[0]?.message?.content || '';
      this.dispatchUsage(response.usage, options?.stage || 'vision', duration, options?.onUsage);

      return text;
    } catch (err: any) {
      console.error(`[RealLLMService] generateTextWithImages 失败 [${this.modelName}]:`, err.message || err);
      throw err;
    }
  }

  public async generateObject<T>(
    prompt: string,
    schema: any,
    systemPrompt?: string,
    options?: LLMOptions
  ): Promise<T> {
    const schemaDesc = typeof schema === 'string' ? schema : JSON.stringify(schema, null, 2);
    const jsonPrompt = `${prompt}\n\n【强制输出规范 (JSON Schema)】：\n请严格输出一个合法的纯 JSON 对象（以 { 开头，以 } 结尾），所有字段名与数据结构必须 100% 精确遵从以下模式定义，严禁自行创造同义词或遗漏关键结构：\n\`\`\`json\n${schemaDesc}\n\`\`\`\n请直接输出纯 JSON 对象（严禁任何自然语言开场白）：`;

    const textResponse = await this.generateText(jsonPrompt, systemPrompt, options);

    const parsedObj = JsonSanitizer.extractJsonFromText<any>(textResponse);
    const normalized = JsonSanitizer.sanitizeAndNormalize<T>(parsedObj, schema);
    return normalized;
  }
}
