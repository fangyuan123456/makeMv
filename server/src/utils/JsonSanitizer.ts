/**
 * utils/JsonSanitizer.ts
 * 大模型 JSON 输出清洗与物理自愈工具 (JsonSanitizer SSOT)
 *
 * 吸收旧版踩坑实战经验，统一提供：
 * 1. 不可见零宽字符与 BOM 剥离 (cleanInvisibleChars)
 * 2. JSON 字符串字面量内裸控制字符转义 (sanitizeControlCharsInStrings)
 * 3. Markdown 围栏与额外括号/截断栈双向平衡修复 (autoCloseJson / extractJsonFromText)
 * 4. 面向 Zod / JSON Schema 的蛇形/驼峰别名对齐、字符串化对象还原与类型归一化 (sanitizeAndNormalize)
 */

export class JsonSanitizer {
  /**
   * 彻底剥离零宽字符、BOM 以及异常 Unicode 分隔符，恢复纯净文本流
   */
  public static cleanInvisibleChars(text: string): string {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u2028\u2029]/g, '\n');
  }

  /**
   * 自动扫描并转义 JSON 字符串字面量内部的裸控制字符 (ASCII 0x00 ~ 0x1F)
   * 彻底杜绝 SyntaxError: Bad control character in string literal in JSON
   */
  public static sanitizeControlCharsInStrings(jsonStr: string): string {
    if (!jsonStr || typeof jsonStr !== 'string') return '';
    let inString = false;
    let isEscaped = false;
    let out = '';

    for (let i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];
      const code = jsonStr.charCodeAt(i);

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
          out += char;
        } else if (char === '\\') {
          isEscaped = true;
          out += char;
        } else if (char === '"') {
          inString = false;
          out += char;
        } else if (code < 32) {
          if (char === '\n') out += '\\n';
          else if (char === '\r') out += '\\r';
          else if (char === '\t') out += '\\t';
          else if (char === '\b') out += '\\b';
          else if (char === '\f') out += '\\f';
          else out += '\\u' + code.toString(16).padStart(4, '0');
        } else {
          out += char;
        }
      } else {
        if (char === '"') {
          inString = true;
        }
        out += char;
      }
    }

    return out;
  }

  /**
   * 自动闭合与平衡因 Token 上限截断或括号过量幻觉导致的 JSON 文本
   */
  public static autoCloseJson(raw: string): string {
    let str = this.sanitizeControlCharsInStrings(this.cleanInvisibleChars(raw)).trim();
    str = str.replace(/`{1,4}[a-zA-Z0-9_-]*$/g, '').trim();

    let inString = false;
    let isEscaped = false;
    const stack: string[] = [];
    let out = '';

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (inString) {
        if (isEscaped) {
          isEscaped = false;
          if (/^["\\\/bfnrtu]$/i.test(char)) {
            out += char;
          } else {
            out += '\\' + char;
          }
        } else if (char === '\\') {
          isEscaped = true;
          out += char;
        } else if (char === '"') {
          inString = false;
          out += char;
        } else {
          out += char;
        }
      } else {
        if (char === '"') {
          inString = true;
          out += char;
        } else if (char === '{') {
          stack.push('}');
          out += char;
        } else if (char === '[') {
          stack.push(']');
          out += char;
        } else if (char === '}' || char === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === char) {
            stack.pop();
            out += char;
          } else if (stack.length > 0) {
            const idx = stack.lastIndexOf(char);
            if (idx !== -1) {
              while (stack.length > idx + 1) {
                out += stack.pop();
              }
              stack.pop();
              out += char;
            }
          }
          // 栈已空时出现多余的右括号/中括号，直接丢弃
        } else {
          out += char;
        }
      }
    }

    let repaired = out;
    if (inString) {
      let backslashCount = 0;
      for (let j = repaired.length - 1; j >= 0; j--) {
        if (repaired[j] === '\\') backslashCount++;
        else break;
      }
      if (backslashCount % 2 === 1) {
        repaired = repaired.slice(0, -1);
      }
      repaired += '"';
    }

    repaired = repaired.replace(/,\s*$/g, '').replace(/,\s*([\}\]])/g, '$1');
    if (/:\s*$/.test(repaired)) {
      repaired += ' null';
    }
    if (/,\s*"[^":,]+"\s*$/.test(repaired)) {
      repaired = repaired.replace(/,\s*"[^":,]+"\s*$/, '');
    }

    while (stack.length > 0) {
      repaired += stack.pop();
    }

    return repaired;
  }

  /**
   * 剥离 Markdown 围栏与多余说明文字，提取最外层的 JSON 字符串并修复常见语法错误
   */
  public static clean(raw: string): string {
    if (!raw || typeof raw !== 'string') return '{}';
    let text = this.sanitizeControlCharsInStrings(this.cleanInvisibleChars(raw)).trim();

    const fenceRegex = /```(?:json|tool_call|tool_calls)?\s*([\s\S]*?)\s*```/i;
    const match = text.match(fenceRegex);
    if (match && match[1]) {
      text = match[1].trim();
    }

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
      } else {
        text = text.slice(startIdx);
      }
    }

    return text.replace(/,\s*([\}\]])/g, '$1');
  }

  /**
   * 物理截断自愈器：修复大模型因达到最大 Token 上限而被粗暴截断的 JSON 串
   */
  public static repairTruncatedJson(raw: string): string {
    if (!raw || typeof raw !== 'string') return '{}';
    let text = this.sanitizeControlCharsInStrings(this.cleanInvisibleChars(raw)).trim();
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) return '{}';
    text = text.slice(firstBrace);

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = this.autoCloseJson(text);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        const lastComma = text.lastIndexOf(',');
        if (lastComma > 0) {
          text = text.slice(0, lastComma);
        } else {
          break;
        }
      }
    }

    return '{}';
  }

  /**
   * 从大模型输出文本或畸形 Tool Call 参数中无损提取并还原 JS 对象/数组
   */
  public static extractJsonFromText<T>(rawText: string): T {
    const text = this.sanitizeControlCharsInStrings(this.cleanInvisibleChars(rawText));

    try {
      return JSON.parse(text.trim()) as T;
    } catch {}

    const markdownMatch = text.match(/```(?:json|tool_call|tool_calls)?\s*([\s\S]*?)\s*```/i);
    const candidateText = markdownMatch ? markdownMatch[1].trim() : text;
    if (markdownMatch) {
      try {
        return JSON.parse(candidateText) as T;
      } catch {}
    }

    const firstBracket = candidateText.indexOf('[');
    const lastBracket = candidateText.lastIndexOf(']');
    const firstBrace = candidateText.indexOf('{');
    const lastBrace = candidateText.lastIndexOf('}');

    const isArray = firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace);
    const startIdx = isArray ? firstBracket : firstBrace;
    const endIdx = isArray ? lastBracket : lastBrace;

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const candidate = candidateText.substring(startIdx, endIdx + 1);
      try {
        return JSON.parse(candidate) as T;
      } catch {}

      try {
        return JSON.parse(candidate.replace(/,\s*([\}\]])/g, '$1')) as T;
      } catch {}
    }

    if (startIdx !== -1) {
      const unclosedCandidate = candidateText.substring(startIdx);
      const autoClosed = this.autoCloseJson(unclosedCandidate);
      try {
        return JSON.parse(autoClosed) as T;
      } catch {}
      try {
        return JSON.parse(autoClosed.replace(/,\s*([\}\]])/g, '$1')) as T;
      } catch {}

      if (!isArray) {
        const repaired = this.repairTruncatedJson(unclosedCandidate);
        try {
          const parsed = JSON.parse(repaired);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            return parsed as T;
          }
        } catch {}
      }
    }

    throw new Error(`[JsonSanitizer] 无法从文本中提取合法 JSON: ${text.substring(0, 150)}...`);
  }

  /**
   * 递归清理值内部的零宽字符与异常文本包装
   */
  public static deepSanitizeValues(val: any): any {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string') {
      return this.cleanInvisibleChars(val);
    }
    if (Array.isArray(val)) {
      return val.map((item) => this.deepSanitizeValues(item));
    }
    if (typeof val === 'object') {
      const cleanedObj: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        cleanedObj[k] = this.deepSanitizeValues(v);
      }
      return cleanedObj;
    }
    return val;
  }

  /**
   * 对照 Zod Schema 执行别名对齐（大小写 / 驼峰 <-> 蛇形）、字符串化对象解析与基础类型归一化
   */
  public static sanitizeAndNormalize<T>(obj: any, schema: any): T {
    if (!obj || typeof obj !== 'object') {
      return (obj || {}) as T;
    }

    const cleanObj = this.deepSanitizeValues(obj) as Record<string, any>;
    const shape =
      typeof schema?.shape === 'function'
        ? schema.shape()
        : schema?.shape || schema?._def?.shape?.();

    if (!shape || typeof shape !== 'object') {
      return cleanObj as T;
    }

    const result: Record<string, any> = { ...cleanObj };

    for (const key of Object.keys(shape)) {
      let node = shape[key];
      let isOptional = false;
      let defaultValue: any = undefined;

      while (node?._def) {
        const typeName = node._def.typeName;
        if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
          isOptional = true;
          node = node._def.innerType;
        } else if (typeName === 'ZodDefault') {
          isOptional = true;
          defaultValue =
            typeof node._def.defaultValue === 'function'
              ? node._def.defaultValue()
              : node._def.defaultValue;
          node = node._def.innerType;
        } else {
          break;
        }
      }

      if (result[key] === undefined || result[key] === null || result[key] === '') {
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        const camelKey = key.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        const candidates = [key.toLowerCase(), key.toUpperCase(), snakeKey, camelKey];
        for (const altKey of candidates) {
          if (cleanObj[altKey] !== undefined && cleanObj[altKey] !== null && cleanObj[altKey] !== '') {
            result[key] = cleanObj[altKey];
            break;
          }
        }
      }

      if ((result[key] === undefined || result[key] === null) && defaultValue !== undefined) {
        result[key] = defaultValue;
      }

      const leafType = node?._def?.typeName;
      if (
        isOptional &&
        (result[key] === null ||
          result[key] === '' ||
          (typeof result[key] === 'string' &&
            (result[key].trim().toLowerCase() === 'null' ||
              result[key].trim().toLowerCase() === 'undefined')))
      ) {
        delete result[key];
        continue;
      }

      if (leafType === 'ZodEnum' && typeof result[key] === 'string') {
        const trimmed = result[key].trim();
        const allowed: string[] = node?._def?.values || [];
        const matched = allowed.find((v) => v.toLowerCase() === trimmed.toLowerCase());
        if (matched) {
          result[key] = matched;
        } else if (isOptional) {
          delete result[key];
        }
      } else if ((leafType === 'ZodObject' || leafType === 'ZodRecord') && typeof result[key] === 'string') {
        const trimmed = result[key].trim();
        if (!trimmed) {
          delete result[key];
        } else {
          try {
            const parsed = this.extractJsonFromText<any>(trimmed);
            result[key] = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? parsed
              : { userPrompt: trimmed };
          } catch {
            result[key] = { userPrompt: trimmed };
          }
        }
      } else if (leafType === 'ZodArray' && result[key] !== undefined && !Array.isArray(result[key])) {
        if (typeof result[key] === 'string') {
          const trimmed = result[key].trim();
          if (!trimmed) {
            result[key] = [];
          } else {
            try {
              const parsed = this.extractJsonFromText<any>(trimmed);
              result[key] = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              result[key] = [trimmed];
            }
          }
        } else {
          result[key] = result[key] ? [result[key]] : [];
        }
      } else if (
        leafType === 'ZodString' &&
        result[key] !== undefined &&
        result[key] !== null &&
        typeof result[key] !== 'string'
      ) {
        result[key] = typeof result[key] === 'object' ? JSON.stringify(result[key]) : String(result[key]);
      } else if (leafType === 'ZodNumber' && typeof result[key] === 'string') {
        const n = Number(result[key]);
        if (!Number.isNaN(n)) result[key] = n;
      } else if (leafType === 'ZodBoolean' && typeof result[key] === 'string') {
        if (result[key].toLowerCase() === 'true') result[key] = true;
        else if (result[key].toLowerCase() === 'false') result[key] = false;
      }
    }

    return result as T;
  }

  /**
   * 安全解析 JSON，解析失败时返回 fallback 兜底对象
   */
  public static parseSafe<T = any>(raw: string, fallback: T): T {
    try {
      return this.extractJsonFromText<T>(raw);
    } catch {
      return fallback;
    }
  }

  /**
   * 强制解析 JSON，失败时抛出结构化错误
   */
  public static parseStrict<T = any>(raw: string): T {
    try {
      return this.extractJsonFromText<T>(raw);
    } catch (err: any) {
      throw new Error(`[JsonSanitizer] JSON 语法解析失败: ${err.message}`);
    }
  }
}
