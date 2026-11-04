/**
 * utils/StreamTagParser.ts
 * 抗 Token 碎片化的流式思考标签 (<think>...</think> / <tool_call>...) 解析状态机 (SSOT)
 *
 * 核心机制（法典 2.2 打字机流式分离与安全拦截）：
 * 1. 跨 Chunk 边界滑动窗口：彻底解决大模型在 <th 与 ink> 边界切分导致裸 includes 判断失效的问题；
 * 2. 状态机驱动：平滑分离正文 (replyText) 与思考流 (thoughtText)；
 * 3. 严格安全拦截：拦截所有 <think>、<thought> 以及 <tool_call> 等内部思维链与模型调度协议标记；
 * 4. 容错净化：自动剥离模型输出的废弃控制标签（如裸 </tool_call>），保障正文 100% 优雅纯净。
 */

export interface ParsedStreamChunk {
  replyText: string;
  thoughtText: string;
}

export class StreamTagParser {
  private buffer: string = '';
  private isThinking: boolean = false;
  private isToolCalling: boolean = false;

  private readonly thinkStart = '<think>';
  private readonly thinkEnd = '</think>';
  private readonly thoughtStart = '<thought>';
  private readonly thoughtEnd = '</thought>';
  private readonly toolStart = '<tool_call>';
  private readonly toolEnd = '</tool_call>';

  /**
   * 喂入一个流式文本碎片，解析并分离出普通打字机正文与思考流
   */
  public feed(chunk: string): ParsedStreamChunk {
    if (!chunk) {
      return { replyText: '', thoughtText: '' };
    }

    this.buffer += chunk;
    let replyText = '';
    let thoughtText = '';

    while (this.buffer.length > 0) {
      if (this.isThinking) {
        // 当前处于 thinking 思考捕获状态 (支持 </think> 与 </thought>)
        const endThinkIdx = this.buffer.indexOf(this.thinkEnd);
        const endThoughtIdx = this.buffer.indexOf(this.thoughtEnd);
        let matchEnd = -1;
        let matchLen = 0;

        if (endThinkIdx !== -1 && (endThoughtIdx === -1 || endThinkIdx <= endThoughtIdx)) {
          matchEnd = endThinkIdx;
          matchLen = this.thinkEnd.length;
        } else if (endThoughtIdx !== -1) {
          matchEnd = endThoughtIdx;
          matchLen = this.thoughtEnd.length;
        }

        if (matchEnd !== -1) {
          thoughtText += this.buffer.slice(0, matchEnd);
          this.buffer = this.buffer.slice(matchEnd + matchLen);
          this.isThinking = false;
          continue;
        }

        // 检查缓冲区尾部是否有可能是思考结束标签的前缀
        const p1 = this.findPotentialPrefix(this.buffer, this.thinkEnd);
        const p2 = this.findPotentialPrefix(this.buffer, this.thoughtEnd);
        const minPrefix = p1 !== -1 && p2 !== -1 ? Math.min(p1, p2) : p1 !== -1 ? p1 : p2;

        if (minPrefix !== -1) {
          thoughtText += this.buffer.slice(0, minPrefix);
          this.buffer = this.buffer.slice(minPrefix);
          break;
        }

        thoughtText += this.buffer;
        this.buffer = '';
      } else if (this.isToolCalling) {
        // 当前处于内部工具调用块，将其隐匿，不作为自然语言正文输出
        const endToolIdx = this.buffer.indexOf(this.toolEnd);
        if (endToolIdx !== -1) {
          this.buffer = this.buffer.slice(endToolIdx + this.toolEnd.length);
          this.isToolCalling = false;
          continue;
        }

        const pTool = this.findPotentialPrefix(this.buffer, this.toolEnd);
        if (pTool !== -1) {
          this.buffer = this.buffer.slice(pTool);
          break;
        }

        this.buffer = '';
      } else {
        // 当前处于普通正文输出状态，检测是否开启思考标签或工具标签
        const sThink = this.buffer.indexOf(this.thinkStart);
        const sThought = this.buffer.indexOf(this.thoughtStart);
        const sTool = this.buffer.indexOf(this.toolStart);

        let earliestIdx = -1;
        let tagType: 'think' | 'thought' | 'tool' = 'think';
        let tagLen = 0;

        if (sThink !== -1 && (earliestIdx === -1 || sThink < earliestIdx)) {
          earliestIdx = sThink;
          tagType = 'think';
          tagLen = this.thinkStart.length;
        }
        if (sThought !== -1 && (earliestIdx === -1 || sThought < earliestIdx)) {
          earliestIdx = sThought;
          tagType = 'thought';
          tagLen = this.thoughtStart.length;
        }
        if (sTool !== -1 && (earliestIdx === -1 || sTool < earliestIdx)) {
          earliestIdx = sTool;
          tagType = 'tool';
          tagLen = this.toolStart.length;
        }

        if (earliestIdx !== -1) {
          replyText += this.buffer.slice(0, earliestIdx);
          this.buffer = this.buffer.slice(earliestIdx + tagLen);
          if (tagType === 'tool') {
            this.isToolCalling = true;
          } else {
            this.isThinking = true;
          }
          continue;
        }

        // 检查缓冲区尾部是否有各标签的前缀
        const pThink = this.findPotentialPrefix(this.buffer, this.thinkStart);
        const pThought = this.findPotentialPrefix(this.buffer, this.thoughtStart);
        const pTool = this.findPotentialPrefix(this.buffer, this.toolStart);

        const candidates = [pThink, pThought, pTool].filter((idx) => idx !== -1);
        if (candidates.length > 0) {
          const minPrefix = Math.min(...candidates);
          replyText += this.buffer.slice(0, minPrefix);
          this.buffer = this.buffer.slice(minPrefix);
          break;
        }

        replyText += this.buffer;
        this.buffer = '';
      }
    }

    // 正文安全净化：剥离偶发的模型裸控制标签（如 </tool_call> 或 }\n</tool_call>）
    replyText = this.sanitizeReplyText(replyText);

    return { replyText, thoughtText };
  }

  /**
   * 冲刷缓冲区残留内容（在流式结束时调用）
   */
  public flush(): ParsedStreamChunk {
    if (!this.buffer) {
      return { replyText: '', thoughtText: '' };
    }

    const remaining = this.buffer;
    this.buffer = '';

    if (this.isThinking) {
      return { replyText: '', thoughtText: remaining };
    }
    if (this.isToolCalling) {
      return { replyText: '', thoughtText: '' };
    }
    return { replyText: this.sanitizeReplyText(remaining), thoughtText: '' };
  }

  /**
   * 清理正文中的孤立控制标记与废弃协议碎片
   */
  private sanitizeReplyText(text: string): string {
    if (!text) return '';
    return text
      .replace(/<\/tool_call>/gi, '')
      .replace(/<tool_call>/gi, '')
      .replace(/<\/think>/gi, '')
      .replace(/<think>/gi, '')
      .replace(/<\/thought>/gi, '')
      .replace(/<thought>/gi, '')
      .replace(/^\s*\}\s*$/gm, ''); // 清理孤立的 JSON 大括号闭合行
  }

  /**
   * 检查 text 的尾部是否为 targetTag 的真前缀
   * @returns 匹配前缀的起始索引，未找到返回 -1
   */
  private findPotentialPrefix(text: string, targetTag: string): number {
    const maxPrefixLen = Math.min(text.length, targetTag.length - 1);
    for (let len = maxPrefixLen; len >= 1; len--) {
      const slice = text.slice(-len);
      if (targetTag.startsWith(slice)) {
        return text.length - len;
      }
    }
    return -1;
  }
}
