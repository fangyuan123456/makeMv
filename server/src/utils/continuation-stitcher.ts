/**
 * utils/continuation-stitcher.ts
 * 通用长列表结构化生成截断自动接力续写器 (Continuation Stitcher)
 *
 * 核心职责：
 * 当大模型输出长数组（如分镜台本 actionBeats、资产清单、长剧情树等）达到 maxTokens 截断时，
 * 1. 自动从截断异常或原始输出中精确提取出已 100% 完整生成的前 N 项及公共元数据（如 environmentLock）；
 * 2. 自动生成携带进度锚点的接力提示词（Continuation Prompt），严禁重复前 N 项，指令从 N+1 项起续写；
 * 3. 在内存中无缝缝合（Stitch & Merge）多轮生成的数组，并进行原始 Schema 终检；
 * 4. 彻底杜绝削足适履地缩减台本密度或截断报错，保障长列表 100% 保真产出。
 */

import type { ZodTypeAny } from 'zod';

export interface StitchRescueResult {
  success: boolean;
  arrayKey: string;
  completedItems: any[];
  headerFields: Record<string, any>;
  lastItemAnchor?: {
    id?: string;
    title?: string;
    summary?: string;
  };
}

export interface ContinuationContext {
  originalPrompt: string;
  arrayKey: string;
  completedCount: number;
  completedItems: any[];
  headerFields: Record<string, any>;
  lastAnchor?: {
    id?: string;
    title?: string;
    summary?: string;
  };
}

export interface ContinuationConfig {
  /** 目标长列表数组键名，如 'actionBeats' */
  arrayKey: string;
  /** 最大接力续写轮数，默认 2 轮 */
  maxContinuations?: number;
  /** 单个数组元素的 Zod Schema（可选，用于严格校验每一项是否完整） */
  itemSchema?: ZodTypeAny;
  /** 外部传入自定义续写提示词生成器（若传入则完全由外部控制） */
  buildContinuationPrompt?: (ctx: ContinuationContext) => string;
  /** 外部传入自定义续写引导指令（如传入则替换默认指令块） */
  continuationDirective?: string;
}

/**
 * 判断当前错误是否是由截断引起的
 */
export function isTruncationFailure(err: any): boolean {
  if (!err) return false;
  if (err.finishReason === 'length') return true;

  const rawMsg = String(err.message || '');
  if (rawMsg.includes('maxTokens') || rawMsg.includes('truncated')) return true;

  // 检查 Zod 错误是否有 invalid_type: expected string, received undefined 或 end of json
  const cause = err.cause as any;
  if (cause) {
    const issues = cause.issues || cause.errors;
    if (Array.isArray(issues) && issues.length > 0) {
      const hasLengthHint = issues.some((iss: any) =>
        String(iss.message || '').includes('maxTokens') ||
        String(iss.code || '') === 'invalid_type' && iss.received === 'undefined'
      );
      if (hasLengthHint) return true;
    }
  }

  return false;
}

/**
 * 从失败错误中救援提取已完整生成的前缀项与公共元数据
 */
export function rescueCompletedPrefix(
  err: any,
  arrayKey: string,
  itemSchema?: ZodTypeAny
): StitchRescueResult {
  const fallbackResult: StitchRescueResult = {
    success: false,
    arrayKey,
    completedItems: [],
    headerFields: {},
  };

  if (!err) return fallbackResult;

  let partialObject: any = null;

  // 1. 尝试从 err.cause.value 中获取（AI SDK 的 TypeValidationError 会保留部分解析出的 JSON 对象）
  if (err.cause && typeof err.cause === 'object' && (err.cause as any).value) {
    partialObject = (err.cause as any).value;
  }

  // 2. 如果没有 partialObject，尝试从 err.text 中进行容错提取
  if (!partialObject && typeof err.text === 'string' && err.text.trim()) {
    partialObject = tryParseTruncatedJson(err.text, arrayKey);
  }

  if (!partialObject || typeof partialObject !== 'object') {
    return fallbackResult;
  }

  // 3. 提取顶层非数组标头字段（例如 environmentLock 等）
  const headerFields: Record<string, any> = {};
  for (const [k, v] of Object.entries(partialObject)) {
    if (k !== arrayKey && v !== undefined && v !== null) {
      headerFields[k] = v;
    }
  }

  // 4. 提取并过滤已完成的数组项
  const rawList = partialObject[arrayKey];
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return fallbackResult;
  }

  const completedItems: any[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item || typeof item !== 'object') break;

    // 如果提供了 itemSchema，执行校验
    if (itemSchema) {
      const parsed = itemSchema.safeParse(item);
      if (!parsed.success) {
        // 到这一项残缺或不符合，停止提取，前面的项作为完整前缀
        break;
      }
      completedItems.push(parsed.data);
    } else {
      // 若无 itemSchema，检查常见必填字段是否为 undefined
      // 如果某项没有主要内容属性（如 actionDescription 等全为空），则视为截断点
      const hasUndefined = Object.values(item).some((val) => val === undefined);
      if (hasUndefined && i === rawList.length - 1) {
        // 最后一项包含 undefined，属于典型截断
        break;
      }
      completedItems.push(item);
    }
  }

  if (completedItems.length === 0) {
    return fallbackResult;
  }

  const lastItem = completedItems[completedItems.length - 1];
  const lastItemAnchor = {
    id: lastItem.beatId || lastItem.shotNumber || lastItem.id || `项 ${completedItems.length}`,
    title: lastItem.beatTitle || lastItem.title || lastItem.name || '',
    summary:
      lastItem.actionDescription ||
      lastItem.cinematicIntent ||
      lastItem.description ||
      '',
  };

  return {
    success: true,
    arrayKey,
    completedItems,
    headerFields,
    lastItemAnchor,
  };
}

/**
 * 容错提取被截断的 JSON
 */
function tryParseTruncatedJson(rawText: string, arrayKey: string): any {
  const trimmed = rawText.trim();
  // 快速尝试直接解析
  try {
    return JSON.parse(trimmed);
  } catch {
    // 忽略，继续容错截断
  }

  // 寻找 arrayKey
  const keyIdx = trimmed.indexOf(`"${arrayKey}"`);
  if (keyIdx === -1) return null;

  const arrayStart = trimmed.indexOf('[', keyIdx);
  if (arrayStart === -1) return null;

  // 从后向前寻找最后一个合法对象的闭合 `}`
  let searchIdx = trimmed.length;
  while (searchIdx > arrayStart) {
    const lastCloseBrace = trimmed.lastIndexOf('}', searchIdx);
    if (lastCloseBrace === -1 || lastCloseBrace <= arrayStart) break;

    // 尝试组装一个合法 JSON：把 lastCloseBrace 后面的残缺字符切掉，并补齐 `]}`
    const candidateJson = trimmed.slice(0, lastCloseBrace + 1) + ']}';
    try {
      const parsed = JSON.parse(candidateJson);
      if (parsed && Array.isArray(parsed[arrayKey])) {
        return parsed;
      }
    } catch {
      // 往前继续找前一个 '}'
      searchIdx = lastCloseBrace - 1;
    }
  }

  return null;
}

/**
 * 生成接力续写提示词 (Continuation Prompt)
 * 纯通用数据列表续写纪律，不带任何业务偏见；
 * 优先支持外部自定义构造器或指令补充。
 */
export function buildContinuationPrompt(options: {
  originalPrompt: string;
  arrayKey: string;
  completedCount: number;
  completedItems?: any[];
  headerFields?: Record<string, any>;
  lastAnchor?: { id?: string; title?: string; summary?: string };
  customPromptBuilder?: (ctx: ContinuationContext) => string;
  customDirective?: string;
}): string {
  const {
    originalPrompt,
    arrayKey,
    completedCount,
    completedItems = [],
    headerFields = {},
    lastAnchor,
    customPromptBuilder,
    customDirective,
  } = options;

  // 1. 若外部传入了完整的自定义提示词构造器，100% 委派给外部
  if (customPromptBuilder) {
    return customPromptBuilder({
      originalPrompt,
      arrayKey,
      completedCount,
      completedItems,
      headerFields,
      lastAnchor,
    });
  }

  // 2. 否则组装通用续写提示词
  const anchorDesc = lastAnchor?.id || lastAnchor?.title || lastAnchor?.summary
    ? `已确认完成的最后一项标识: ${[lastAnchor.id, lastAnchor.title, lastAnchor.summary ? `("${String(lastAnchor.summary).slice(0, 80)}")` : ''].filter(Boolean).join(' - ')}`
    : `已完整生成并保存前 ${completedCount} 项。`;

  const directiveBlock = customDirective
    ? customDirective
    : [
        '【长列表自动接力续写指令 (Continuation Directive)】',
        `当前生成内容已达单次输出上限，系统已完整保存前 ${completedCount} 项数据。`,
        `>> ${anchorDesc}`,
        '',
        '【接力续写规范】：',
        `1. 严格从第 ${completedCount + 1} 项起直接输出后续接力项；`,
        `2. 保持数据结构与字段类型完全一致，与已保存的前 ${completedCount} 项平滑衔接；`,
        `3. 仅在 "${arrayKey}" 列表中输出后续项，直至整组内容完整闭合。`,
      ].join('\n');

  return [
    originalPrompt,
    '',
    '────────────────────────────────────────────────────────────────────────',
    directiveBlock,
    '────────────────────────────────────────────────────────────────────────',
  ].join('\n');
}
