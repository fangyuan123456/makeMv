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

  private state: 'WAITING_KEY' | 'IN_KEY' | 'WAITING_COLON' | 'WAITING_VALUE' | 'IN_VALUE' = 'WAITING_KEY';
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

      if (this.state === 'IN_VALUE') {
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
          // 当前目标字符串值解析完毕
          this.state = 'WAITING_KEY';
          continue;
        }

        this.onChunk(ch);
        continue;
      }

      if (this.state === 'WAITING_KEY') {
        if (ch === '"') {
          this.state = 'IN_KEY';
          this.currentKey = '';
          this.isEscaped = false;
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
          this.state = 'WAITING_COLON';
        } else {
          this.currentKey += ch;
        }
        continue;
      }

      if (this.state === 'WAITING_COLON') {
        if (ch === ':') {
          if (this.targetKeys.has(this.currentKey)) {
            this.state = 'WAITING_VALUE';
          } else {
            this.state = 'WAITING_KEY';
          }
        } else if (!/\s/.test(ch)) {
          this.state = 'WAITING_KEY';
        }
        continue;
      }

      if (this.state === 'WAITING_VALUE') {
        if (ch === '"') {
          this.state = 'IN_VALUE';
          this.isEscaped = false;
          this.isUnicode = false;
          this.unicodeHex = '';
        } else if (!/\s/.test(ch)) {
          // 值不是字符串（可能是 null/对象/数字），放弃当前 key
          this.state = 'WAITING_KEY';
        }
        continue;
      }
    }
  }

  /**
   * 重置状态机
   */
  public reset(): void {
    this.state = 'WAITING_KEY';
    this.currentKey = '';
    this.isEscaped = false;
    this.isUnicode = false;
    this.unicodeHex = '';
  }
}
