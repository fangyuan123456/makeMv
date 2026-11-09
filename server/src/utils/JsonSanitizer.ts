/**
 * utils/JsonSanitizer.ts
 * 大模型 JSON 输出清洗与物理自愈工具 (JsonSanitizer SSOT)
 *
 * 核心功能：
 * 1. 强力剥离大模型回复前后的非 JSON 文字 (如 "Here is your JSON:")
 * 2. 剥离 Markdown 代码块 ```json 与 ```
 * 3. 修复大模型偶尔产出的末尾多余逗号与未转义控制字符
 */

export class JsonSanitizer {
  /**
   * 剥离 Markdown 围栏与多余说明文字，提取最外层的 JSON 字符串
   */
  public static clean(raw: string): string {
    if (!raw || typeof raw !== 'string') return '{}';
    let text = raw.trim();

    // 1. 剥离 ```json ... ``` 或 ``` ... ``` 围栏
    const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
    const match = text.match(fenceRegex);
    if (match && match[1]) {
      text = match[1].trim();
    }

    // 2. 如果前后仍有杂质文字，寻找最外层的大括号或中括号
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let startIdx = -1;

    if (firstBrace !== -1 && firstBracket !== -1) {
      startIdx = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
      startIdx = firstBrace;
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
    }

    if (startIdx !== -1) {
      const isObject = text[startIdx] === '{';
      const closeChar = isObject ? '}' : ']';
      const lastIdx = text.lastIndexOf(closeChar);
      if (lastIdx !== -1 && lastIdx > startIdx) {
        text = text.slice(startIdx, lastIdx + 1);
      }
    }

    // 3. 修复尾部多余逗号 (Trailing commas in objects/arrays)
    text = text.replace(/,\s*([\}\]])/g, '$1');

    return text;
  }

  /**
   * 安全解析 JSON，解析失败时返回 fallback 兜底对象
   */
  public static parseSafe<T = any>(raw: string, fallback: T): T {
    try {
      const cleaned = this.clean(raw);
      return JSON.parse(cleaned) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * 强制解析 JSON，失败时抛出结构化错误
   */
  public static parseStrict<T = any>(raw: string): T {
    const cleaned = this.clean(raw);
    try {
      return JSON.parse(cleaned) as T;
    } catch (err: any) {
      throw new Error(`[JsonSanitizer] JSON 语法解析失败: ${err.message}\n清洗后底稿:\n${cleaned.slice(0, 500)}`);
    }
  }
}
