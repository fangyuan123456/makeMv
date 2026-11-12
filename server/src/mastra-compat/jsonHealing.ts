/**
 * mastra-compat/jsonHealing.ts
 * 针对 Mastra 与国产大模型在流式 Tool Call 输出时的无损语法自愈扩展 (AI SDK Middleware SSOT)
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
