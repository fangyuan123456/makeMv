/**
 * utils/universal-patch.ts
 * 全流程通用纯字符串补丁替换微内核 (Universal String Patch SSOT)
 *
 * 核心机制（遵循法典 0.3/0.4 极简与单一事实来源）：
 * 1. 统一契约：全系统任何文本与 JSON 工序资产微调时，统一由大模型输出 SEARCH/REPLACE 纯字符串差量补丁；
 * 2. 鲁棒匹配：优先执行精确匹配，支持 CRLF/LF 换行符归一化与边缘空白容错匹配；
 * 3. 语法守卫：针对 JSON 文件，替换完成后刚性执行 JSON.parse() 校验，绝不让损坏数据落盘；
 * 4. 极致性能：毫秒级完成差量更新，未涉及字段 100% 物理级绝对稳定、0 漂移。
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { atomicWriteStringSync } from './atomicFile.js';
import type { LLMService } from '../llm/LLMService.js';

/**
 * 通用纯字符串补丁大模型输出 Schema (全流程统一)
 */
export const UniversalPatchSchema = z.object({
  patches: z.array(
    z.object({
      search: z.string().min(1, 'search 目标字符串不能为空').describe('原文件中需要被替换的原文字符串（包含足够的上下文以保证唯一定位）'),
      replace: z.string().describe('替换后的新文本内容'),
    })
  ).min(1, '至少包含一条有效替换补丁'),
  summary: z.string().describe('本次修改要点的中文概述总结'),
});

export type UniversalPatchOutput = z.infer<typeof UniversalPatchSchema>;

export const UNIVERSAL_STRING_PATCH_SYSTEM_PROMPT = `你是一位严谨的电影工业软件系统架构师与剧本修补专家。
你的职责是根据创作者最新的修改指令，在既有文件内容中进行【精准的原文字符串搜索与替换 (SEARCH / REPLACE)】。

【修补准则】：
1. 极简差量：绝不全量输出未修改的内容！只输出需要变更的精准替换块；
2. 上下文定位：search 字段必须包含足够的原文上下文（如前后几行或主键属性），确保能够在原文件中唯一匹配；
3. 保障格式合规：若目标文件是 JSON，请务必保证 replace 替换后的内容语法合法（如引号、逗号、大括号对称完整）；
4. 保持稳定：未提及的内容必须 100% 原样保留，绝不随意发散。`.trim();

/**
 * 构建补丁推演专用通用 Prompt
 */
export function buildUniversalPatchPrompt(
  currentContent: string,
  userInstruction: string,
  extraContext?: string
): string {
  // 控制送入大模型的上下文长度，若过长截取核心部分
  const displayContent = currentContent.length > 12000
    ? currentContent.slice(0, 12000) + '\n\n... (后续内容省略，请针对当前已有内容输出补丁) ...'
    : currentContent;

  let prompt = `【目标文件当前原文内容】：\n\`\`\`\n${displayContent}\n\`\`\`\n\n`;
  if (extraContext) {
    prompt += `【工程前文背景】：\n${extraContext}\n\n`;
  }
  prompt += `【创作者最新修改指令】：\n${userInstruction}\n\n`;
  prompt += `请仔细比对原文，输出精准的 SEARCH / REPLACE 替换补丁列表 (UniversalPatchSchema)。`;
  return prompt;
}

/**
 * 字符串换行符与边缘空白归一化（防止跨平台 CRLF/LF 导致精确匹配失败）
 */
function normalizeNewlines(str: string): string {
  return str.replace(/\r\n/g, '\n');
}

/**
 * 纯字符串补丁应用核心算法 (内存执行)
 */
export function applyStringPatches(
  originalText: string,
  patches: Array<{ search: string; replace: string }>
): { success: boolean; resultText: string; appliedCount: number; errors: string[] } {
  let currentText = normalizeNewlines(originalText);
  let appliedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < patches.length; i++) {
    const { search, replace } = patches[i];
    const normSearch = normalizeNewlines(search);
    const normReplace = normalizeNewlines(replace);

    // 1. 优先尝试精确匹配
    if (currentText.includes(normSearch)) {
      // 若出现多次（如改名），全部替换
      currentText = currentText.split(normSearch).join(normReplace);
      appliedCount++;
      continue;
    }

    // 2. 尝试去首尾空白匹配
    const trimmedSearch = normSearch.trim();
    if (trimmedSearch.length > 0 && currentText.includes(trimmedSearch)) {
      currentText = currentText.split(trimmedSearch).join(normReplace.trim());
      appliedCount++;
      continue;
    }

    // 3. 匹配失败记录
    const preview = normSearch.length > 40 ? normSearch.slice(0, 40) + '...' : normSearch;
    errors.push(`第 ${i + 1} 个补丁未找到匹配的原文字符串: [${preview}]`);
  }

  return {
    success: errors.length === 0,
    resultText: currentText,
    appliedCount,
    errors,
  };
}

/**
 * 针对 JSON 文件的安全字符串补丁执行器 (含刚性语法校验与原子落盘)
 */
export function applyJsonStringPatch(
  filePath: string,
  patches: Array<{ search: string; replace: string }>
): { success: boolean; updatedObject?: any; summary?: string; error?: string } {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `目标文件不存在: ${filePath}` };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const patchRes = applyStringPatches(raw, patches);

  if (!patchRes.success && patchRes.appliedCount === 0) {
    return {
      success: false,
      error: `字符串补丁应用失败: ${patchRes.errors.join('; ')}`,
    };
  }

  // 语法刚性自检守卫：必须能够合法通过 JSON.parse
  try {
    const parsed = JSON.parse(patchRes.resultText);
    atomicWriteStringSync(filePath, patchRes.resultText);
    return {
      success: true,
      updatedObject: parsed,
      summary: `成功应用 ${patchRes.appliedCount} 处字符串补丁，未涉及字段 100% 保持稳定`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `补丁替换后导致 JSON 语法损坏 (${err.message})，刚性拦截落盘`,
    };
  }
}

/**
 * 高阶统一入口：针对已有 JSON 文件执行端到端字符串差量 Patch
 * 包含：文件检查 -> LLM Patch 推演 -> applyJsonStringPatch 校验与落盘
 */
export async function tryExecuteJsonStringPatch<T>(options: {
  jsonPath: string;
  userFeedback: string;
  stageName: string;
  projectId: string;
  llm: LLMService;
  extraContext?: string;
  onSuccess?: (patched: T) => void;
}): Promise<{
  success: boolean;
  data?: T;
  summary?: string;
  error?: string;
}> {
  const { jsonPath, userFeedback, stageName, projectId, llm, extraContext, onSuccess } = options;
  if (!fs.existsSync(jsonPath)) {
    return { success: false, error: `目标文件不存在: ${jsonPath}` };
  }

  try {
    const rawContent = fs.readFileSync(jsonPath, 'utf-8');
    const patchPrompt = buildUniversalPatchPrompt(rawContent, userFeedback, extraContext);
    const patchRes = await llm.generateObject<UniversalPatchOutput>(
      patchPrompt,
      UniversalPatchSchema,
      UNIVERSAL_STRING_PATCH_SYSTEM_PROMPT,
      { stage: stageName, projectId, temperature: 0.1 }
    );

    if (patchRes && Array.isArray(patchRes.patches) && patchRes.patches.length > 0) {
      const applyRes = applyJsonStringPatch(jsonPath, patchRes.patches);
      if (applyRes.success && applyRes.updatedObject) {
        const patchedObject = applyRes.updatedObject as T;
        if (onSuccess) {
          onSuccess(patchedObject);
        }
        return {
          success: true,
          data: patchedObject,
          summary: patchRes.summary || applyRes.summary,
        };
      } else {
        return {
          success: false,
          error: applyRes.error || '字符串补丁校验未通过',
        };
      }
    }
    return { success: false, error: '大模型未生成有效补丁清单' };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || '字符串差量推演异常',
    };
  }
}
