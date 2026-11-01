/**
 * utils/JsonSanitizer.ts
 * 
 * 用于对大模型输出的 JSON 格式进行非标准清洗，
 * 并对对齐 JSON Schema 结构进行清洗、驼峰转换、字段补全与类型强制纠正（如强制补足空数组/空对象）。
 */

export class JsonSanitizer {
  /**
   * 彻底剥离零宽字符、BOM 以及异常 Unicode 控制字符，恢复纯净文本流
   */
  public static cleanInvisibleChars(text: string): string {
    if (!text) return '';
    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // 剥离零宽空格 (Zero-Width Space/Joiner) 与 BOM
      .replace(/\u00A0/g, ' ') // 不间断空格归一化为普通空格
      .replace(/[\u2028\u2029]/g, '\n'); // 行/段分隔符归一化为换行
  }

  /**
   * 🌟 自动扫描并转义 JSON 字符串字面量内部的裸控制字符 (ASCII 0x00 ~ 0x1F)
   * 彻底杜绝 SyntaxError: Bad control character in string literal in JSON
   */
  public static sanitizeControlCharsInStrings(jsonStr: string): string {
    if (!jsonStr) return '';
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
          // 捕获字符串内部的裸控制字符，合规转换为 JSON 标准转义序列
          if (char === '\n') {
            out += '\\n';
          } else if (char === '\r') {
            out += '\\r';
          } else if (char === '\t') {
            out += '\\t';
          } else if (char === '\b') {
            out += '\\b';
          } else if (char === '\f') {
            out += '\\f';
          } else {
            out += '\\u' + code.toString(16).padStart(4, '0');
          }
        } else {
          out += char;
        }
      } else {
        if (char === '"') {
          inString = true;
          out += char;
        } else {
          out += char;
        }
      }
    }

    return out;
  }

  /**
   * 从大模型输出的长文本中剥离并提取出标准的 JSON 对象
   * @param text LLM 回传文本
   */
  public static extractJsonFromText<T>(rawText: string): T {
    const cleanedText = this.cleanInvisibleChars(rawText);
    const text = this.sanitizeControlCharsInStrings(cleanedText);
    // 1. 尝试直接 JSON.parse
    try {
      return JSON.parse(text.trim()) as T;
    } catch {}

    // 2. 剥离 ```json 或 ```tool_call 或 ``` markdown 代码块包裹
    const markdownMatch = text.match(/```(?:json|tool_call|tool_calls)?\s*([\s\S]*?)\s*```/i);
    let candidateText = text;
    if (markdownMatch) {
      candidateText = markdownMatch[1].trim();
      try {
        return JSON.parse(candidateText) as T;
      } catch {}
    }

    // 3. 支持最外层 [...] 数组或 {...} 对象边界提取
    const firstBracket = candidateText.indexOf('[');
    const lastBracket = candidateText.lastIndexOf(']');
    const firstBrace = candidateText.indexOf('{');
    const lastBrace = candidateText.lastIndexOf('}');

    let isArray = false;
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      isArray = true;
    }

    const startIdx = isArray ? firstBracket : firstBrace;
    const endIdx = isArray ? lastBracket : lastBrace;

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const candidate = candidateText.substring(startIdx, endIdx + 1);
      try {
        return JSON.parse(candidate) as T;
      } catch {}

      // 4. 清洗非标 JSON 语法（仅当直接解析失败时尝试移除尾随逗号）
      try {
        const cleaned = candidate.replace(/,\s*([\}\]])/g, '$1');
        return JSON.parse(cleaned) as T;
      } catch {}
    }

    // 5. 🌟 词法级截断与过量符号双向平衡自愈 (Bracket Stack Balancing)
    if (startIdx !== -1) {
      const unclosedCandidate = candidateText.substring(startIdx);
      try {
        const autoClosed = this.autoCloseJson(unclosedCandidate);
        try {
          return JSON.parse(autoClosed) as T;
        } catch {}
        const trailingCleaned = autoClosed.replace(/,\s*([\}\]])/g, '$1');
        return JSON.parse(trailingCleaned) as T;
      } catch {}
    }

    // 6. 🌟 次级多代码块级联扫描
    const startPositions: number[] = [];
    const blockRegex = /(\[|\{)\s*(?:\{\s*)?"(?:tool|name|path|args|parameters|jobId|gameTitle|files|classes)"/gi;
    let bMatch: RegExpExecArray | null;
    while ((bMatch = blockRegex.exec(text)) !== null) {
      startPositions.push(bMatch.index);
    }
    const globalFirstBracket = text.indexOf('[');
    if (globalFirstBracket !== -1 && !startPositions.includes(globalFirstBracket)) startPositions.push(globalFirstBracket);
    const globalFirstBrace = text.indexOf('{');
    if (globalFirstBrace !== -1 && !startPositions.includes(globalFirstBrace)) startPositions.push(globalFirstBrace);

    const candidateIndices = Array.from(new Set(startPositions)).sort((a, b) => b - a);
    for (const pos of candidateIndices) {
      const sub = text.substring(pos);
      try {
        const autoClosed = this.autoCloseJson(sub);
        const parsed = JSON.parse(autoClosed) as T;
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch {}
    }

    throw new Error(`[JsonSanitizer] Failed to extract valid JSON from LLM text response: ${text.substring(0, 150)}...`);
  }

  /**
   * 自动闭合与平衡由于 Token 上限截断或括号过量幻觉导致的 JSON 文本
   */
  public static autoCloseJson(raw: string): string {
    let str = raw.trim();
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
        } else if (char === '\n') {
          out += '\\n';
        } else if (char === '\r') {
          out += '\\r';
        } else if (char === '\t') {
          out += '\\t';
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
      const closing = stack.pop();
      repaired += closing;
    }

    return repaired;
  }

  /**
   * 针对 fallback 返回的 JSON 对象执行 Schema 级清洗与属性对齐
   */
  public static sanitizeAndNormalize<T>(obj: any, schema: any): T {
    if (!obj || typeof obj !== 'object') {
      return (obj || {}) as T;
    }

    let properties: Record<string, { type?: string; description?: string; default?: any }> = {};

    if (schema) {
      if (schema.properties) {
        properties = schema.properties;
      } else if (schema.jsonSchema && schema.jsonSchema.properties) {
        properties = schema.jsonSchema.properties;
      } else if (schema.schema && schema.schema.properties) {
        properties = schema.schema.properties;
      } else if (schema._def?.typeName === 'ZodObject' || schema.shape) {
        const shape = typeof schema.shape === 'function' ? schema.shape() : (schema.shape || schema._def?.shape?.());
        if (shape) {
          for (const k of Object.keys(shape)) {
            const node = shape[k];
            let typeName = node?._def?.typeName || '';
            let defaultValue: any = undefined;

            if (typeName === 'ZodDefault') {
              defaultValue = typeof node._def.defaultValue === 'function' ? node._def.defaultValue() : node._def.defaultValue;
              typeName = node._def.innerType?._def?.typeName || '';
            } else if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
              typeName = node._def.innerType?._def?.typeName || '';
            }

            let expectedType = 'string';
            if (typeName === 'ZodArray') expectedType = 'array';
            else if (typeName === 'ZodNumber') expectedType = 'number';
            else if (typeName === 'ZodBoolean') expectedType = 'boolean';
            else if (typeName === 'ZodObject' || typeName === 'ZodRecord') expectedType = 'object';

            properties[k] = {
              type: expectedType,
              description: node?.description || '',
              default: defaultValue,
            };
          }
        }
      }
    }

    obj = this.deepSanitizeValues(obj);

    if (!properties || Object.keys(properties).length === 0) {
      return obj as T;
    }

    const result = { ...obj };

    for (const key of Object.keys(properties)) {
      const propDef = properties[key];
      const expectedType = propDef.type;

      if (result[key] === undefined || result[key] === null || result[key] === '') {
        const potentialKeys = [
          key.toLowerCase(),
          key.toUpperCase(),
          key.replace(/([A-Z])/g, '_$1').toLowerCase(),
          key.replace(/_([a-z])/g, (_, g) => g.toUpperCase())
        ];

        for (const altKey of potentialKeys) {
          if (obj[altKey] !== undefined && obj[altKey] !== null && obj[altKey] !== '') {
            result[key] = obj[altKey];
            break;
          }
        }
      }

      if (result[key] === undefined || result[key] === null || result[key] === '') {
        if (propDef.default !== undefined) {
          result[key] = propDef.default;
        } else if (expectedType === 'array') {
          result[key] = [];
        } else if (expectedType === 'string') {
          result[key] = '';
        } else if (expectedType === 'number' || expectedType === 'integer') {
          result[key] = 0;
        } else if (expectedType === 'boolean') {
          result[key] = false;
        } else if (expectedType === 'object') {
          result[key] = {};
        }
      }

      if (expectedType === 'array' && !Array.isArray(result[key])) {
        result[key] = result[key] ? [result[key]] : [];
      }
    }

    return result as T;
  }

  /**
   * 全局递归深度自愈器
   */
  public static deepSanitizeValues(val: any): any {
    if (val === null || val === undefined) return val;

    if (typeof val === 'string') {
      const trimmed = val.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('(') && trimmed.endsWith(')'))) {
        try {
          const parsed = JSON.parse(trimmed.replace(/^\(/, '[').replace(/\)$/, ']'));
          if (Array.isArray(parsed)) {
            return parsed.map((item) => (typeof item === 'number' ? item : (typeof item === 'string' ? item : parseFloat(item) || item)));
          }
        } catch {
          const nums = trimmed.replace(/[\[\]\(\)]/g, '').split(/[\s,]+/).filter(Boolean).map(Number);
          if (nums.length > 0 && !nums.some(isNaN)) {
            return nums;
          }
        }
      }
      return val;
    }

    if (Array.isArray(val)) {
      return val.map((item) => this.deepSanitizeValues(item));
    }

    if (typeof val === 'object') {
      const cleanedObj: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const vObj = v as Record<string, any>;
          if (vObj.type === 'none' || vObj.type === 'null') {
            continue;
          }
        }
        cleanedObj[k] = this.deepSanitizeValues(v);
      }
      return cleanedObj;
    }

    return val;
  }
}
