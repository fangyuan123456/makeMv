/**
 * utils/JsonStreamStringExtractor.ts
 * 流式 JSON 字符串属性增量提取状态机 (JsonStreamStringExtractor SSOT)
 *
 * 核心目标：
 * 在开启 experimental_toolCallStreaming 时，从 tool-call-delta 接收的 JSON 碎片文本中，
 * 实时、零延迟、单字符流式提取指定目标字段（如 reasoning, summary, description）的未转义自然语言文本，
 * 并实时回调给 onChunk，支撑打字机实时流式输出。
 */

export interface JsonStreamStringExtractorOptions {
  targetKeys: string[];
  onChunk: (chunk: string) => void;
}

export class JsonStreamStringExtractor {
  private targetKeys: Set<string>;
  private onChunk: (chunk: string) => void;

  private state: 'DEFAULT' | 'IN_KEY' | 'IN_TARGET_VALUE' | 'SKIP_STRING' = 'DEFAULT';
  private depth: number = 0;
  private expectingValue: boolean = false;
  private matchedTargetKey: boolean = false;
  private currentKey: string = '';
  private isEscaped: boolean = false;
  private isUnicode: boolean = false;
  private unicodeHex: string = '';

  constructor(options: JsonStreamStringExtractorOptions) {
    this.targetKeys = new Set(options.targetKeys);
    this.onChunk = options.onChunk;
  }

  /**
   * 喂入增量文本片段 (如 argsTextDelta)
   */
  public feed(chunk: string): void {
    if (!chunk) return;

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      if (this.state === 'IN_TARGET_VALUE') {
        if (this.isUnicode) {
          this.unicodeHex += ch;
          if (this.unicodeHex.length === 4) {
            const charCode = parseInt(this.unicodeHex, 16);
            if (!isNaN(charCode)) {
              this.onChunk(String.fromCharCode(charCode));
            }
            this.isUnicode = false;
            this.unicodeHex = '';
          }
          continue;
        }

        if (this.isEscaped) {
          this.isEscaped = false;
          if (ch === 'n') this.onChunk('\n');
          else if (ch === 'r') this.onChunk('\r');
          else if (ch === 't') this.onChunk('\t');
          else if (ch === '"') this.onChunk('"');
          else if (ch === '\\') this.onChunk('\\');
          else if (ch === '/') this.onChunk('/');
          else if (ch === 'b') this.onChunk('\b');
          else if (ch === 'f') this.onChunk('\f');
          else if (ch === 'u') {
            this.isUnicode = true;
            this.unicodeHex = '';
          } else {
            this.onChunk(ch);
          }
          continue;
        }

        if (ch === '\\') {
          this.isEscaped = true;
          continue;
        }

        if (ch === '"') {
          this.state = 'DEFAULT';
          this.matchedTargetKey = false;
          this.expectingValue = false;
          continue;
        }

        this.onChunk(ch);
        continue;
      }

      if (this.state === 'SKIP_STRING') {
        if (this.isEscaped) {
          this.isEscaped = false;
        } else if (ch === '\\') {
          this.isEscaped = true;
        } else if (ch === '"') {
          this.state = 'DEFAULT';
          if (this.depth === 1 && this.expectingValue) {
            this.matchedTargetKey = false;
          }
        }
        continue;
      }

      if (this.state === 'IN_KEY') {
        if (this.isEscaped) {
          this.isEscaped = false;
          this.currentKey += ch;
        } else if (ch === '\\') {
          this.isEscaped = true;
        } else if (ch === '"') {
          this.matchedTargetKey = this.targetKeys.has(this.currentKey);
          this.state = 'DEFAULT';
        } else {
          this.currentKey += ch;
        }
        continue;
      }

      // DEFAULT 状态：追踪 JSON 嵌套层级，仅在顶层 (depth === 1) 匹配目标字段
      if (ch === '{' || ch === '[') {
        if (this.depth === 1) {
          this.matchedTargetKey = false;
        }
        this.depth++;
        if (this.depth === 1) {
          this.expectingValue = false;
          this.matchedTargetKey = false;
        }
        continue;
      }

      if (ch === '}' || ch === ']') {
        this.depth = Math.max(0, this.depth - 1);
        if (this.depth === 0) {
          this.expectingValue = false;
          this.matchedTargetKey = false;
        }
        continue;
      }

      if (this.depth === 1) {
        if (ch === ':') {
          this.expectingValue = true;
          continue;
        }
        if (ch === ',') {
          this.expectingValue = false;
          this.matchedTargetKey = false;
          continue;
        }
        if (ch === '"') {
          if (!this.expectingValue) {
            this.state = 'IN_KEY';
            this.currentKey = '';
            this.isEscaped = false;
          } else if (this.matchedTargetKey) {
            this.state = 'IN_TARGET_VALUE';
            this.isEscaped = false;
            this.isUnicode = false;
            this.unicodeHex = '';
          } else {
            this.state = 'SKIP_STRING';
            this.isEscaped = false;
          }
          continue;
        }
      } else if (ch === '"') {
        this.state = 'SKIP_STRING';
        this.isEscaped = false;
      }
    }
  }

  /**
   * 重置状态机
   */
  public reset(): void {
    this.state = 'DEFAULT';
    this.depth = 0;
    this.expectingValue = false;
    this.matchedTargetKey = false;
    this.currentKey = '';
    this.isEscaped = false;
    this.isUnicode = false;
    this.unicodeHex = '';
  }
}
