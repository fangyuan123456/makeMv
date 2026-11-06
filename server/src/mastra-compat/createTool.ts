/**
 * mastra-compat/createTool.ts
 * 专门针对 Mastra 官方微内核进行增强与兼容重写的 Tool 创建工厂 (Mastra Compat Tool SSOT)
 * 
 * 核心机制（完全遵照用户架构思路）：
 * 1. 开发者传给 createTool 的是完整的业务强类型 Zod Schema；
 * 2. 包装器在 createTool 位置将复杂 Schema 清洗为模型最兼容的纯字符串形式 (Stringified Schema)；
 * 3. 彻底避免 anyOf 与多层嵌套导致的 OpenAI 兼容网关丢工具与流式解析崩溃；
 * 4. 大模型调用后，包装器在 execute 与提取阶段无缝由原始 Schema 校验还原为强类型对象。
 */

import { createTool as mastraCreateTool } from '@mastra/core/tools';
import { z } from 'zod';
import { RealLLMService } from '../llm/RealLLMService.js';
import { JsonSanitizer } from '../utils/JsonSanitizer.js';

export interface WrappedToolConfig<TInput = any, TOutput = any> {
  id: string;
  description: string;
  inputSchema?: z.ZodType<TInput, any, any> | any;
  outputSchema?: z.ZodType<TOutput, any, any> | any;
  execute: (inputData: TInput, context?: any) => Promise<TOutput>;
  [key: string]: any;
}

/**
 * 将任意复杂的 Zod Schema 清洗转换为网关 100% 兼容的平铺字符串 Schema
 */
export function cleanSchemaToStringFields(schema: any): z.ZodObject<any> {
  if (!schema || typeof schema !== 'object') {
    return z.object({});
  }

  const shape = typeof schema.shape === 'function' ? schema.shape() : (schema.shape || schema._def?.shape?.());
  if (!shape) {
    return z.object({ payload: z.string().default('').describe('JSON 格式参数字符串') });
  }

  const cleanedShape: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(shape)) {
    const field = shape[key];
    const desc = field?.description || `${key} 参数`;
    
    // 若字段本身就是合法的字符串枚举 (ZodEnum)，完整保留以刚性约束模型行为且完全兼容网关
    if (field instanceof z.ZodEnum || field?._def?.typeName === 'ZodEnum') {
      cleanedShape[key] = field;
    } else {
      // 复杂或嵌套字段降维为平铺字符串
      cleanedShape[key] = z.string().default('').describe(desc);
    }
  }

  return z.object(cleanedShape);
}

/**
 * 通用工具参数强类型安全还原器 (Safe Args Resolver)
 * 将模型传回的字符串形式参数通过原始 Zod Schema 严格还原
 */
export function resolveToolArgs<T>(rawArgs: any, originalSchema: z.ZodType<T, any, any>): T | undefined {
  if (rawArgs === undefined || rawArgs === null) return undefined;

  // 1. 若原始参数已完全符合原始 Schema，直接通过
  const directParsed = originalSchema.safeParse(rawArgs);
  if (directParsed.success) {
    return directParsed.data;
  }

  // 2. 尝试利用 JsonSanitizer 进行容错提取与类型归一化
  try {
    let candidateObj = rawArgs;
    if (typeof rawArgs === 'string') {
      candidateObj = JsonSanitizer.extractJsonFromText<any>(rawArgs);
    }
    const normalized = JsonSanitizer.sanitizeAndNormalize<T>(candidateObj, originalSchema);
    return normalized;
  } catch {
    return undefined;
  }
}

/**
 * 包装重写 Mastra 原生 createTool
 */
export function createTool<TInput = any, TOutput = any>(config: WrappedToolConfig<TInput, TOutput>): any {
  const { inputSchema, execute, description, ...rest } = config;

  if (!inputSchema) {
    return mastraCreateTool(config as any);
  }

  // 1. 将原 Schema 规范编译并追加到 Tool description 中，强化语义约束
  let schemaOutline = '';
  try {
    schemaOutline = RealLLMService.formatSchemaForPrompt(inputSchema);
  } catch {
    schemaOutline = '';
  }

  const enhancedDescription = schemaOutline
    ? `${description.trim()}\n\n【参数字段必须严格遵从以下模式】：\n\`\`\`json\n${schemaOutline}\n\`\`\``
    : description;

  // 2. 在重写的位置将复杂 Schema 清洗转换为纯字符串 Schema (对外暴露给底座模型)
  const cleanedStringSchema = cleanSchemaToStringFields(inputSchema);

  // 3. 包装 execute：收到模型的字符串参数后，转回原始强类型 Schema 对象传给业务 execute
  const wrappedExecute = async (params: any, context?: any) => {
    const raw = (params && typeof params === 'object' && 'context' in params && params.context)
      ? params.context
      : params;

    const normalizedData = resolveToolArgs<TInput>(raw, inputSchema);
    if (!normalizedData) {
      throw new Error(`[createTool] 无法将工具参数还原为合法 Schema 结构`);
    }

    return await execute(normalizedData, context);
  };

  const tool = mastraCreateTool({
    ...rest,
    description: enhancedDescription,
    inputSchema: cleanedStringSchema,
    execute: wrappedExecute,
  });

  (tool as any)._originalInputSchema = inputSchema;

  return tool;
}
