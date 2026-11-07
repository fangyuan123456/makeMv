/**
 * llm/RealLLMService.ts
 * 生产级大模型驱动服务 (基于 Vercel AI SDK 构建)
 */

import { createOpenAI } from '@ai-sdk/openai';
import {
  generateText as aiGenerateText,
  generateObject as aiGenerateObject,
  streamText as aiStreamText,
  streamObject as aiStreamObject,
} from 'ai';
import type { LLMService, LLMOptions } from './LLMService.js';
import { config } from '../utils/config.js';
import { JsonSanitizer } from '../utils/JsonSanitizer.js';

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

  private getEffectiveSignal(customSignal?: AbortSignal, timeoutMs?: number): AbortSignal {
    const effectiveTimeout = timeoutMs ?? config.llm.timeoutMs;
    const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
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
    const effectiveSignal = this.getEffectiveSignal(options?.abortSignal, options?.timeoutMs);
    const { text } = await aiGenerateText({
      model: this.modelInstance,
      system: systemPrompt,
      prompt,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
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
    const schemaOutline = RealLLMService.formatSchemaForPrompt(schema);
    const jsonPrompt = `${prompt}\n\n【强制输出规范 (JSON Schema)】：\n请严格输出一个合法的纯 JSON 字符串对象（以 { 开头，以 } 结尾），所有字段名与数据结构必须 100% 精确遵从以下模式定义，严禁自行创造同义词或遗漏关键结构：\n\`\`\`json\n${schemaOutline}\n\`\`\`\n请直接输出纯 JSON 对象（严禁任何自然语言开场白）：`;

    // LLM 文本输出本质是随机的：偶发的围栏异常 / 截断 / 引号未转义会让单次解析失败。
    // 解析失败时重采样重试一次（提升温度打破失败模式），两次都失败才把错误上抛。
    let lastError: Error = new Error('未执行生成');
    for (let attempt = 1; attempt <= 2; attempt++) {
      const textResponse = await this.generateText(
        jsonPrompt,
        systemPrompt,
        attempt === 1
          ? options
          : { ...options, temperature: Math.max(options?.temperature ?? 0.2, 0.5) }
      );

      try {
        const parsedObj = JsonSanitizer.extractJsonFromText<any>(textResponse);
        if (!parsedObj) throw new Error('提取结果为空');
        return JsonSanitizer.sanitizeAndNormalize<T>(parsedObj, schema);
      } catch (err: any) {
        lastError = err;
        console.warn(
          `[RealLLMService] generateObject 第 ${attempt}/2 次输出无法解析为 JSON` +
            `(stage=${options?.stage || 'unknown'}, 响应 ${textResponse.length} 字符): ${err.message}` +
            `${attempt < 2 ? ' → 重采样重试…' : ' → 放弃'}`
        );
        if (attempt === 2) {
          console.error(
            `[RealLLMService] 两次解析均失败，响应头部 1500 字符:\n${textResponse.substring(0, 1500)}`
          );
        }
      }
    }
    throw lastError;
  }

  public static formatSchemaForPrompt(schema: any): string {
    if (!schema) return '（无指定 Schema）';
    if (typeof schema === 'string') return schema;

    const enumRules: string[] = [];

    function parseZodNode(zodNode: any, path = '', depth = 0): any {
      if (!zodNode) return 'any';
      const desc = zodNode.description ? ` (${zodNode.description})` : '';

      if (zodNode._def?.typeName === 'ZodObject' || zodNode.shape) {
        if (depth > 6) return { '<key>': '<any>' };
        const shape = typeof zodNode.shape === 'function' ? zodNode.shape() : (zodNode.shape || zodNode._def?.shape?.());
        if (shape) {
          const obj: Record<string, any> = {};
          for (const key of Object.keys(shape)) {
            const nextPath = path ? `${path}.${key}` : key;
            obj[key] = parseZodNode(shape[key], nextPath, depth + 1);
          }
          return obj;
        }
      }

      if (zodNode._def?.typeName === 'ZodArray') {
        const element = zodNode._def.type;
        if (depth > 6) return ['<item>'];
        return [parseZodNode(element, `${path}[]`, depth + 1)];
      }

      if (zodNode._def?.innerType) {
        return parseZodNode(zodNode._def.innerType, path, depth);
      }

      if (zodNode._def?.typeName === 'ZodLazy') {
        if (depth > 3) return '{ "name": "<string>", "children": [] }';
        try {
          const lazyType = zodNode._def.getter();
          return parseZodNode(lazyType, path, depth + 1);
        } catch {
          return '{ [key: string]: any }';
        }
      }

      if (zodNode._def?.typeName === 'ZodEnum') {
        const values: string[] = zodNode._def.values || [];
        const formattedEnumStr = values.map((v) => `"${v}"`).join(' | ');
        if (path) {
          enumRules.push(`- \`${path}\` 必须严格在以下合法取值中单选一个：[ ${formattedEnumStr} ]${desc}`);
        }
        return `<${formattedEnumStr}>`;
      }

      if (zodNode._def?.typeName === 'ZodTuple') {
        const items = zodNode._def.items || [];
        return items.map((it: any) => parseZodNode(it, path, depth + 1));
      }

      if (zodNode._def?.typeName === 'ZodUnion') {
        const options = zodNode._def.options || [];
        if (options.length > 0) {
          return parseZodNode(options[0], path, depth);
        }
      }

      if (zodNode._def?.typeName === 'ZodRecord') {
        const valType = zodNode._def.valueType;
        const parsedVal = valType ? parseZodNode(valType, path, depth + 1) : 'any';
        return {
          '<key>': parsedVal,
        };
      }

      if (zodNode.properties && typeof zodNode.properties === 'object') {
        const obj: Record<string, any> = {};
        for (const key of Object.keys(zodNode.properties)) {
          const p = zodNode.properties[key];
          const pDesc = p.description ? ` (${p.description})` : '';
          const nextPath = path ? `${path}.${key}` : key;
          obj[key] = `${p.type || 'string'}${pDesc}`;
        }
        return obj;
      }

      const typeName = zodNode._def?.typeName?.replace(/^Zod/, '').toLowerCase() || zodNode.type || 'string';
      return `<${typeName}${desc}>`;
    }

    let jsonStructure = '';
    try {
      jsonStructure = JSON.stringify(parseZodNode(schema), null, 2);
    } catch {
      try {
        jsonStructure = JSON.stringify(schema, null, 2);
      } catch {
        jsonStructure = String(schema);
      }
    }

    if (enumRules.length > 0) {
      return `${jsonStructure}\n\n### 🚨 强类型枚举与单选约束 (必须严格遵从，严禁创造未列出的别名或枚举值)：\n${enumRules.join('\n')}`;
    }

    return jsonStructure;
  }

  public async streamText(
    prompt: string,
    systemPrompt?: string,
    onChunk?: (chunk: string) => void,
    options?: LLMOptions
  ): Promise<string> {
    const effectiveSignal = this.getEffectiveSignal(options?.abortSignal, options?.timeoutMs);
    const result = aiStreamText({
      model: this.modelInstance,
      system: systemPrompt,
      prompt,
      temperature: options?.temperature,
      abortSignal: effectiveSignal,
    });

    let fullText = '';
    for await (const chunk of result.textStream) {
      fullText += chunk;
      if (onChunk) {
        onChunk(chunk);
      }
    }
    return fullText;
  }

  public async streamObject<T>(
    prompt: string,
    schema: any,
    systemPrompt?: string,
    onChunk?: (chunk: { type: 'reply' | 'thought'; text: string }) => void,
    options?: LLMOptions
  ): Promise<T> {
    const effectiveSignal = this.getEffectiveSignal(options?.abortSignal, options?.timeoutMs);
    const { partialObjectStream, object } = aiStreamObject({
      model: this.modelInstance,
      schema,
      system: systemPrompt,
      prompt,
      temperature: options?.temperature,
      abortSignal: effectiveSignal,
    });

    let replySent = 0;
    let thoughtSent = 0;

    for await (const partial of partialObjectStream as any) {
      if (onChunk) {
        const reply = partial.reply ?? '';
        if (reply.length > replySent) {
          onChunk({ type: 'reply', text: reply.slice(replySent) });
          replySent = reply.length;
        }

        const thought = partial.thought ?? '';
        if (thought.length > thoughtSent) {
          onChunk({ type: 'thought', text: thought.slice(thoughtSent) });
          thoughtSent = thought.length;
        }
      }
    }

    const finalObject = await object;
    return finalObject as T;
  }
}
