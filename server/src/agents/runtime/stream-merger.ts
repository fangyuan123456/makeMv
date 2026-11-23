/**
 * agents/runtime/stream-merger.ts
 * 流式对白与工具参数流合并与清洗净化深模块 (Deep Module)
 *
 * 核心架构职责：
 * 1. 合并自然语言流 (text-delta) 与意图工具参数流 (emit_director_intent.reply)，杜绝正文被吞；
 * 2. 净化助手发言，过滤内部自愈纠偏日志、协议元标签与调试括号。
 */

export interface MergeStreamedParams {
  streamedOutputSource: 'text' | 'tool' | null;
  fullRawText: string;
  streamedReplyText: string;
  toolReply: string;
}

export interface MergeStreamedResult {
  finalText: string;
  appendChunk: string;
}

/**
 * 合并自然语言流 (text-delta) 与意图工具参数流 (emit_director_intent.reply)，
 * 彻底杜绝模型“先说过渡开场白 + 再把完整正文写入 tool.reply”时正文被静默吞掉的问题。
 */
export function mergeStreamedAndToolReply(params: MergeStreamedParams): MergeStreamedResult {
  const raw = params.fullRawText.trim();
  const reply = (params.toolReply || params.streamedReplyText || '').trim();

  if (params.streamedOutputSource === 'tool') {
    const finalText = reply || raw;
    const streamed = params.streamedReplyText;
    const appendChunk =
      finalText && streamed && finalText.startsWith(streamed) && finalText.length > streamed.length
        ? finalText.slice(streamed.length)
        : '';
    return { finalText, appendChunk };
  }

  if (params.streamedOutputSource === 'text') {
    if (!reply || reply === raw || raw.includes(reply)) {
      return { finalText: raw, appendChunk: '' };
    }
    if (reply.startsWith(raw)) {
      return { finalText: reply, appendChunk: reply.slice(raw.length) };
    }
    const idx = reply.indexOf(raw);
    if (idx > 0) {
      return { finalText: reply, appendChunk: reply.slice(idx + raw.length) };
    }
    const separator = '\n\n';
    return { finalText: `${raw}${separator}${reply}`, appendChunk: `${separator}${reply}` };
  }

  const finalText = reply || raw;
  return { finalText, appendChunk: finalText };
}

/**
 * 助手发言安全净化器：刚性剥离内部自愈纠偏日志、协议元标签与未自动生成卡片的调试括号，杜绝系统噪音暴露给创作者
 */
export function sanitizeAssistantSpeech(text: string): string {
  if (!text) return '';
  return text
    // 过滤各种括号包裹的“未自动生成执行卡片”或“缺少面向创作者说明”的内部报错
    .replace(/[（(]\s*注[：:]\s*未自动生成执行卡片[^\n）)]*[）)]/gi, '')
    .replace(/[（(]\s*注[：:]\s*缺少面向创作者说明[^\n）)]*[）)]/gi, '')
    .replace(/[（(]\s*注[：:]\s*已自动为您生成上述工序卡片[^\n）)]*[）)]/gi, '')
    .replace(/[（(]\s*系统提示[：:][^\n）)]*[）)]/gi, '')
    .replace(/<system_correction>[\s\S]*?<\/system_correction>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
}
