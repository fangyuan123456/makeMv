/**
 * mastra-compat/jsonHealing.ts
 * 专为 Mastra 官方微内核在流式接收国产模型 (如 Qwen2.5/SiliconFlow) 时多括号/尾随字符的无损自愈扩展
 * 
 * 核心保障：
 * 1. 采用严格的防重入门禁 (Reentrancy Guard)，杜绝递归调用与内存溢出；
 * 2. 仅拦截以 { 或 [ 开头的大模型生成 JSON 片段的语法错误，不污染任何非 JSON 字符串解析；
 * 3. 彻底消除 Mastra 内部 "Error converting tool call input to JSON" 警告。
 */

import { JsonSanitizer } from '../utils/JsonSanitizer.js';

let isHealingInstalled = false;
let isRepairing = false;

export function installMastraJsonSelfHealing(): void {
  if (isHealingInstalled) return;
  isHealingInstalled = true;

  const origParse = JSON.parse;

  JSON.parse = function (text: any, reviver?: any) {
    try {
      return origParse.call(this, text, reviver);
    } catch (err) {
      if (
        !isRepairing &&
        typeof text === 'string' &&
        (text.trim().startsWith('{') || text.trim().startsWith('['))
      ) {
        isRepairing = true;
        try {
          const repaired = JsonSanitizer.extractJsonFromText(text);
          if (repaired !== null && repaired !== undefined && typeof repaired === 'object') {
            return repaired;
          }
        } catch {
          // 自愈失败，透传原始异常
        } finally {
          isRepairing = false;
        }
      }
      throw err;
    }
  };
}
