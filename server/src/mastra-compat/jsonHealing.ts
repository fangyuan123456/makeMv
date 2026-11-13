/**
 * mastra-compat/jsonHealing.ts
 * 针对 Mastra 与国产大模型 JSON 输出的兼容性自愈扩展 (AI SDK Middleware SSOT)
 *
 * 两条路径：
 * 1. 流式 Tool Call 参数语法抢救（toolCallJsonHealingMiddleware）；
 * 2. 结构化对象生成的 null 字段归一化（healStructuredObjectText），见文件末尾说明。
 *
 * 关键边界：
 * 绝不能劫持全局 JSON.parse！@ai-sdk/openai 流式解析 tool_calls 时会对每一个分片增量调用
 * isParsableJson(SecureJSON.parse -> JSON.parse) 判断参数是否闭合；若全局 JSON.parse 在半截
 * 分片（如 '{"action":"start'）就强行自愈成功，会导致 SDK 误判工具调用已完成并丢弃后续分片。
 * 因此必须在 wrapLanguageModel 的 wrapStream 中等到 `finish` 收齐全部增量后，再兜底抢救未落地的参数。
 */

import {
  wrapLanguageModel,
  type LanguageModelV1,
  type LanguageModelV1Middleware,
  type LanguageModelV1StreamPart,
} from 'ai';
import { JsonSanitizer } from '../utils/JsonSanitizer.js';

interface PendingToolDelta {
  toolName: string;
  argsText: string;
  emitted: boolean;
}

/**
 * 流式 Tool Call 抢救中间件：
 * @ai-sdk/openai 在流式解析 tool_calls 时仅当 isParsableJson() 为 true 才 emit `tool-call`。
 * 若大模型在 args 末尾多吐了一个 `}`、包含未转义换行或截断缺括号，finish 时会直接丢失整次工具调用。
 * 本中间件等到 finish 收齐全部 tool-call-delta 后，通过 JsonSanitizer 无损修复并补发标准 `tool-call`。
 */
export const toolCallJsonHealingMiddleware: LanguageModelV1Middleware = {
  middlewareVersion: 'v1',
  wrapStream: async ({ doStream }) => {
    const result = await doStream();
    const pending = new Map<string, PendingToolDelta>();

    const flushUnemittedToolCalls = (
      controller: TransformStreamDefaultController<LanguageModelV1StreamPart>
    ): boolean => {
      let rescuedAny = false;
      for (const [toolCallId, entry] of pending.entries()) {
        if (entry.emitted || !entry.argsText.trim()) continue;
        try {
          const repaired = JsonSanitizer.extractJsonFromText<Record<string, unknown>>(entry.argsText);
          if (repaired && typeof repaired === 'object') {
            entry.emitted = true;
            rescuedAny = true;
            console.warn(
              `[mastra-compat/jsonHealing] 已无损修复流式畸形 Tool Call [${entry.toolName}] 参数`
            );
            controller.enqueue({
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId,
              toolName: entry.toolName,
              args: JSON.stringify(repaired),
            });
          }
        } catch (err: any) {
          console.warn(
            `[mastra-compat/jsonHealing] Tool Call [${entry.toolName}] 参数修复失败，跳过:`,
            err?.message || err
          );
        }
      }
      return rescuedAny;
    };

    const transformedStream = result.stream.pipeThrough(
      new TransformStream<LanguageModelV1StreamPart, LanguageModelV1StreamPart>({
        transform(part, controller) {
          if (part.type === 'tool-call-delta') {
            const existing = pending.get(part.toolCallId);
            if (existing) {
              existing.argsText += part.argsTextDelta;
            } else {
              pending.set(part.toolCallId, {
                toolName: part.toolName,
                argsText: part.argsTextDelta || '',
                emitted: false,
              });
            }
            controller.enqueue(part);
            return;
          }

          if (part.type === 'tool-call') {
            const existing = pending.get(part.toolCallId);
            if (existing) {
              existing.emitted = true;
            } else {
              pending.set(part.toolCallId, {
                toolName: part.toolName,
                argsText: part.args,
                emitted: true,
              });
            }
            controller.enqueue(part);
            return;
          }

          if (part.type === 'finish') {
            const rescued = flushUnemittedToolCalls(controller);
            controller.enqueue(
              rescued && part.finishReason === 'stop'
                ? { ...part, finishReason: 'tool-calls' }
                : part
            );
            return;
          }

          controller.enqueue(part);
        },
        flush(controller) {
          flushUnemittedToolCalls(controller);
        },
      })
    );

    return {
      ...result,
      stream: transformedStream,
    };
  },
};

export function withToolCallJsonHealingMiddleware(model: LanguageModelV1): LanguageModelV1 {
  return wrapLanguageModel({
    model,
    middleware: toolCallJsonHealingMiddleware,
  });
}

/**
 * 结构化对象生成（generateObject / object-json 模式）路径的 null 归一化。
 *
 * 国产模型习惯把「本轮不适用的可选字段」写成 null，而业务契约普遍用 z.optional()，
 * Zod 不接受 null → AI SDK 抛 "response did not match schema"，整条 workflow 失败。
 * 工具入参路径已由 resolveToolArgs / experimental_repairToolCall 做同类归一化，但
 * Mastra 0.2 的 Agent.generate({ output }) 直接调 generateObject 且不透传 repairText，
 * 因此只能在模型文本进入 AI SDK 校验之前统一清洗，一处覆盖所有结构化输出工序。
 */
export function stripNullFieldsFromJsonText(
  text: string | undefined
): { text: string | undefined; changed: boolean } {
  if (!text || !text.trim()) return { text, changed: false };

  let changed = false;
  const walk = (value: any): any => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const cleaned: Record<string, any> = {};
      for (const [key, child] of Object.entries(value)) {
        if (child === null) {
          changed = true;
          continue;
        }
        cleaned[key] = walk(child);
      }
      return cleaned;
    }
    return value;
  };

  // 1. 优先尝试直接快速 JSON.parse
  try {
    const cleaned = walk(JSON.parse(text));
    return changed ? { text: JSON.stringify(cleaned), changed: true } : { text, changed: false };
  } catch {
    // 2. 原生 parse 失败（常见于国产模型包含 ```json 围栏、<think> 思考标签或尾随杂质），通过 JsonSanitizer 自愈提取
    try {
      const repaired = JsonSanitizer.extractJsonFromText<any>(text);
      if (repaired && typeof repaired === 'object') {
        const cleaned = walk(repaired);
        // 成功提取并清洗，生成纯净合法的 JSON 字符串
        return { text: JSON.stringify(cleaned), changed: true };
      }
    } catch {
      // 自愈提取彻底失败，原样交回 AI SDK 自身报错
    }
    return { text, changed: false };
  }
}

/** 只处理对象生成模式；仅当确实剥离过 null 或修复过语法才改写结果，避免无谓重排文本。 */
export function healStructuredObjectText(result: any, options: any): any {
  const isObjectMode =
    options?.mode?.type === 'object-json' ||
    options?.mode?.type === 'object-tool' ||
    options?.mode?.type?.startsWith('object');
  if (!isObjectMode || !result?.text) return result;
  const { text, changed } = stripNullFieldsFromJsonText(result.text);
  if (!changed || text === undefined) return result;
  console.warn('[mastra-compat/jsonHealing] 结构化输出已剥离 null 可选字段并自愈修复 JSON');
  return { ...result, text };
}
