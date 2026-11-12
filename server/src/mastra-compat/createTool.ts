/**
 * mastra-compat/createTool.ts
 * 针对 Mastra 微内核与大模型网关 Tool Schema 兼容性的增强封装 (Mastra Compat Tool SSOT)
 *
 * 吸收旧版踩坑实战经验：
 * 1. 调用方保留完整业务强类型 Zod Schema（嵌套对象、z.record、z.array、optional/default）；
 * 2. 在 createTool 边界将非 Enum 字段平铺清洗为网关 100% 兼容的纯 string / ZodEnum Schema；
 *    - 严格保留可选语义（绝不把 .optional().default(...) 保留为网关 schema 的 default，防误判必填）
 *    - 禁止在工具 description 中附加 ```json 代码示例，防止 DeepSeek 模仿输出假 JSON 文本
 * 3. 在 execute 入口与意图提取边界通过 JsonSanitizer 无损还原为原始强类型 Schema 对象。
 */

import { createTool as mastraCreateTool } from '@mastra/core/tools';
import { z } from 'zod';
import { JsonSanitizer } from '../utils/JsonSanitizer.js';

export interface CompatToolConfig<TInput extends z.ZodTypeAny = z.ZodTypeAny, TOutput = any> {
  id: string;
  description: string;
  inputSchema?: TInput;
  outputSchema?: z.ZodTypeAny;
  execute: (params: { context: z.infer<TInput>; mastra?: any; runId?: string }) => Promise<TOutput>;
  [key: string]: any;
}

/**
 * 拆解 ZodOptional / ZodNullable / ZodDefault 包装层，判定可选性与最内层核心类型
 */
function unwrapZodField(field: any): { isOptional: boolean; inner: any } {
  let current = field;
  let isOptional = false;

  while (current?._def) {
    const typeName = current._def.typeName;
    if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
      isOptional = true;
      current = current._def.innerType;
    } else {
      break;
    }
  }

  return { isOptional, inner: current };
}

/**
 * 将任意复杂 Zod Schema 清洗转换为商用/开源网关 100% 兼容的平铺字符串/枚举 Schema
 */
export function cleanSchemaToStringFields(schema: any): z.ZodObject<any> {
  if (!schema || typeof schema !== 'object') {
    return z.object({});
  }

  const shape =
    typeof schema.shape === 'function'
      ? schema.shape()
      : schema.shape || schema._def?.shape?.();

  if (!shape) {
    return z.object({ payload: z.string().optional().describe('JSON 格式参数字符串') });
  }

  const cleanedShape: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(shape)) {
    const rawField = shape[key];
    const { isOptional, inner } = unwrapZodField(rawField);
    const desc = rawField?.description || inner?.description || `${key} 参数`;

    if (inner instanceof z.ZodEnum || inner?._def?.typeName === 'ZodEnum') {
      cleanedShape[key] = (isOptional ? inner.optional() : inner).describe(desc);
    } else if (isOptional) {
      cleanedShape[key] = z.string().optional().describe(desc);
    } else {
      cleanedShape[key] = z.string().describe(desc);
    }
  }

  return z.object(cleanedShape);
}

/**
 * 通用工具参数强类型安全还原器 (Safe Args Resolver)
 * 将模型回传的字符串化、蛇形别名或轻度畸形参数按原始 Zod Schema 严格还原
 */
export function resolveToolArgs<T>(rawArgs: any, originalSchema: z.ZodType<T, any, any>): T | undefined {
  if (rawArgs === undefined || rawArgs === null) return undefined;

  const directParsed = originalSchema.safeParse(rawArgs);
  if (directParsed.success) {
    return directParsed.data;
  }

  try {
    let candidateObj = rawArgs;
    if (typeof rawArgs === 'string') {
      candidateObj = JsonSanitizer.extractJsonFromText<any>(rawArgs);
    }
    const normalized = JsonSanitizer.sanitizeAndNormalize<any>(candidateObj, originalSchema);
    const parsedNormalized = originalSchema.safeParse(normalized);
    if (parsedNormalized.success) {
      return parsedNormalized.data;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 包装重写 Mastra 原生 createTool：对外保持 `{ context }` 标准契约，内部自动做 Schema 清洗与参数还原
 */
export function createTool<TInput extends z.ZodTypeAny = z.ZodTypeAny, TOutput = any>(
  config: CompatToolConfig<TInput, TOutput>
): any {
  const { inputSchema, execute, description, ...rest } = config;

  if (!inputSchema) {
    return mastraCreateTool(config as any);
  }

  const enhancedDescription = (description || '').trim();
  const cleanedStringSchema = cleanSchemaToStringFields(inputSchema);

  const wrappedExecute = async (params: any) => {
    const hasContext = params && typeof params === 'object' && 'context' in params;
    const raw = hasContext ? params.context : params;
    const normalizedData = resolveToolArgs(raw, inputSchema);
    if (normalizedData === undefined) {
      throw new Error(`[mastra-compat/createTool] 工具 [${config.id}] 参数无法还原为合法 Schema 结构`);
    }

    if (hasContext) {
      return await execute({ ...params, context: normalizedData });
    }
    return await execute({ context: normalizedData });
  };

  const tool = mastraCreateTool({
    ...rest,
    description: enhancedDescription,
    inputSchema: cleanedStringSchema as any,
    execute: wrappedExecute as any,
  });

  (tool as any)._originalInputSchema = inputSchema;
  (tool as any)._cleanedInputSchema = cleanedStringSchema;

  return tool;
}
