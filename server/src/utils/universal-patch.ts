/**
 * utils/universal-patch.ts
 * 全流程通用纯字符串补丁替换微内核 (Universal String Patch SSOT)
 *
 * 核心机制（遵循法典 0.3/0.4 极简与单一事实来源）：
 * 1. 统一契约：全系统任何文本与 JSON 工序资产微调时，统一由大模型输出 SEARCH/REPLACE 纯字符串差量补丁；
 * 2. 多文件归属：补丁必须声明 file，文本轨一次调用可横跨多个产物，但不允许跨文件猜测；
 * 3. 鲁棒匹配：优先执行精确匹配，支持 CRLF/LF 换行符归一化、边缘空白容错，
 *    以及空白弹性匹配（内容 token 一致、仅空白/换行形态不符时放行）；
 * 4. 语法守卫：针对 JSON 文件，替换完成后刚性执行 JSON.parse() 校验，绝不让损坏数据落盘；
 * 5. 两阶段提交：多文件补丁全部命中且全部解析通过后才统一写盘，任一失败整体回滚；
 * 6. 极致性能：毫秒级完成差量更新，未涉及字段 100% 物理级绝对稳定、0 漂移。
 */

import fs from 'fs';
import { z } from 'zod';
import { atomicWriteStringSync } from './atomicFile.js';
import type { LLMService } from '../llm/LLMService.js';

/**
 * 通用纯字符串补丁大模型输出 Schema (全流程统一)
 *
 * file 字段：多文件模式下必填，取值为 prompt 中 <<<FILE: xxx>>> 的 xxx；
 *            单文件模式可留空，表示对当前唯一目标文件生效。
 */
export const UniversalPatchSchema = z.object({
  patches: z
    .array(
      z.object({
        file: z
          .string()
          .optional()
          .describe(
            '补丁所属文件名（多文件模式下必填，必须与提供的文件清单中的某一项完全一致；单文件模式可留空）'
          ),
        search: z
          .string()
          .min(1, 'search 目标字符串不能为空')
          .describe('原文件中需要被替换的原文字符串（包含足够的上下文以保证唯一定位）'),
        replace: z.string().describe('替换后的新文本内容'),
      })
    )
    .min(1, '至少包含一条有效替换补丁'),
  summary: z.string().describe('本次修改要点的中文概述总结'),
});

export type UniversalPatchOutput = z.infer<typeof UniversalPatchSchema>;

/** 单条补丁（file 可选，兼容单文件模式） */
export interface PlannedPatch {
  file?: string;
  search: string;
  replace: string;
}

export const UNIVERSAL_STRING_PATCH_SYSTEM_PROMPT = `你是一位严谨的电影工业软件系统架构师与剧本修补专家。
你的职责是根据创作者最新的修改指令，在既有文件内容中进行【精准的原文字符串搜索与替换 (SEARCH / REPLACE)】。

【修补准则】：
1. 极简差量：绝不全量输出未修改的内容！只输出需要变更的精准替换块；
2. 上下文定位：search 字段必须包含足够的原文上下文（如前后几行或主键属性），确保能够在原文件中唯一匹配；
3. 保障格式合规：若目标文件是 JSON，请务必保证 replace 替换后的内容语法合法（如引号、逗号、大括号对称完整）；
4. JSON 是带缩进的多行文本：search 必须逐字复制原文（包括换行与缩进）。
   最稳妥的做法是只截取原文中同一行的连续片段作为 search（如 "role": "男主角"），
   禁止把多行内容拼成一行、或凭想象改写键值对的排版；
5. 保持稳定：未提及的内容必须 100% 原样保留，绝不随意发散。`.trim();

export const MULTI_FILE_PATCH_SYSTEM_PROMPT = `${UNIVERSAL_STRING_PATCH_SYSTEM_PROMPT}

【多文件归属准则】：
6. 每条补丁必须填写 file 字段，取值必须与提供的文件清单中的文件名完全一致，不得自创路径；
7. 只有「同一事实被其它文件引用」时才允许跨文件同步（如角色改名后，其它文件中对该角色的称呼）；
   禁止借机改写未被要求的内容，未被涉及的文件不要输出补丁；
8. search 必须是原文中的逐字连续片段，禁止改写、缩写、补全或意译。
   若无法确定整句原文，就缩短 search（取其中最确定的一小段），绝不凭印象写整句；
9. 全局替换（改名、改称谓、统一术语）：每个文件只需输出一条短补丁，
   search 就是被替换的原文片段本身（如「李娜」），不要逐句罗列「…李娜…」的整句补丁。
   **此条优先于第 2、8 条**：凡是同一处替换在文件中反复出现，就用短补丁一次覆盖，
   不要为每一处出现单独造补丁。整单补丁通常 1~5 条，超过 8 条基本可以断定你在逐句罗列。`.trim();

/**
 * 构建单文件补丁推演 Prompt（保留给单体调用路径；文本轨已统一走多文件构建器）
 *
 * 注意：这里不再做字符截断。截断会让模型看不到后半段原文，
 * 导致针对文件尾部的修改必然生成匹配不到的 search 串，属于静默错误来源。
 * 上下文预算由多文件构建器统一处理（超预算时降级为骨架索引，而不是硬截断）。
 */
export function buildUniversalPatchPrompt(
  currentContent: string,
  userInstruction: string,
  extraContext?: string
): string {
  let prompt = `【目标文件当前原文内容】：\n\`\`\`\n${currentContent}\n\`\`\`\n\n`;
  if (extraContext) {
    prompt += `【工程前文背景】：\n${extraContext}\n\n`;
  }
  prompt += `【创作者最新修改指令】：\n${userInstruction}\n\n`;
  prompt += `请仔细比对原文，输出精准的 SEARCH / REPLACE 替换补丁列表 (UniversalPatchSchema)。`;
  return prompt;
}

/** 多文件补丁输入项 */
export interface MultiFilePatchFile {
  /** 文件名（相对项目根的产物路径），补丁 file 字段必须与此完全一致 */
  fileName: string;
  /** 产物中文名，用于 prompt 分段说明 */
  title: string;
  /** 文件全文 */
  content: string;
  /** 骨架索引（角色 id/名、场次 id/标题、镜头 id 等），预算超限时替代全文 */
  skeleton?: string;
  /** 本次请求的主命中文件，预算超限时保留其全文 */
  isPrimary?: boolean;
}

/**
 * 多文件上下文预算（字符）。
 * 仅作为「防止上下文溢出」的安全阀，正常项目远达不到。
 * 一旦触发，非主命中文件降级为骨架索引——这是有意识的降级，不是例行截断。
 */
export const MULTI_FILE_PROMPT_BUDGET = 120_000;

/**
 * 构建多文件补丁推演 Prompt
 */
export function buildMultiFilePatchPrompt(
  files: MultiFilePatchFile[],
  userInstruction: string,
  extraContext?: string
): string {
  const listing = files.map((f) => `- ${f.fileName}　（${f.title}）`).join('\n');

  const body = files
    .map((f) => `<<<FILE: ${f.fileName}>>>\n${f.content}\n<<<END FILE>>>`)
    .join('\n\n');

  let prompt = `【可修改文件清单（补丁的 file 字段只能取以下值）】：\n${listing}\n\n`;
  prompt += `【文件原文】：\n${body}\n\n`;
  if (extraContext) {
    prompt += `【工程前文背景】：\n${extraContext}\n\n`;
  }
  prompt += `【创作者最新修改指令】：\n${userInstruction}\n\n`;
  prompt += `请仔细比对原文，输出精准的 SEARCH / REPLACE 替换补丁列表 (UniversalPatchSchema)，每条补丁必须带上 file 归属。`;
  return prompt;
}

/**
 * 字符串换行符与边缘空白归一化（防止跨平台 CRLF/LF 导致精确匹配失败）
 */
function normalizeNewlines(str: string): string {
  return str.replace(/\r\n/g, '\n');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 空白弹性正则：search 的内容 token 之间允许任意形式的空白（空格/换行/缩进）。
 *
 * 典型场景：多行缩进 JSON 里模型把 search 写成单行拼接
 * （"name": "杰克", "role": "男主角"），而原文是逐行带缩进的——
 * 内容完全正确、只有空白形态不符，属于应被容忍的模型输出习惯。
 */
function buildWhitespaceFlexibleRegex(search: string): RegExp | null {
  const tokens = search.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null; // 单 token 交给精确/trim 匹配，避免过宽命中
  return new RegExp(tokens.map(escapeRegExp).join('\\s+'), 'g');
}

/**
 * 纯字符串补丁应用核心算法 (内存执行)
 *
 * 两遍处理：先尽力应用，再对未命中的补丁做确定性归因，绝不靠猜测放行。
 *
 * 归因规则只有两条，都可被机械验证：
 *   1. 覆盖：search 已消失但 replace 已就位 —— 说明别的补丁已经达成了同一意图；
 *   2. 等价：该补丁恰好等于「一条已生效的短替换补丁」作用在这段原文上的结果，
 *      即 replace === search.split(短search).join(短replace)。
 *      改名场景里模型常既给一条「李娜→林晚」，又逐句给出「…李娜…→…林晚…」，
 *      逐句那批一旦被宽补丁抢先替换就再也匹配不上，但意图显然已被满足。
 * 其余情形一律视为真实失败，由调用方整体拦截。
 */
export function applyStringPatches(
  originalText: string,
  patches: Array<{ search: string; replace: string }>,
  options: { tolerateAlreadyApplied?: boolean } = {}
): {
  success: boolean;
  resultText: string;
  appliedCount: number;
  benignCount: number;
  errors: string[];
} {
  let currentText = normalizeNewlines(originalText);
  const applied: Array<{ search: string; replace: string }> = [];
  const misses: Array<{ search: string; replace: string }> = [];

  // 第一遍：尽力应用
  for (const { search, replace } of patches) {
    const normSearch = normalizeNewlines(search);
    const normReplace = normalizeNewlines(replace);

    if (currentText.includes(normSearch)) {
      // 若出现多次（如改名），全部替换
      currentText = currentText.split(normSearch).join(normReplace);
      applied.push({ search: normSearch, replace: normReplace });
      continue;
    }

    const trimmedSearch = normSearch.trim();
    if (trimmedSearch.length > 0 && currentText.includes(trimmedSearch)) {
      currentText = currentText.split(trimmedSearch).join(normReplace.trim());
      applied.push({ search: trimmedSearch, replace: normReplace.trim() });
      continue;
    }

    // 第三档：空白弹性匹配——内容 token 逐字一致、仅空白形态不符时放行。
    // 替换值用模型的 replace 原样落入，最终由 JSON.parse 语法守卫兜底。
    const flexibleRegex = buildWhitespaceFlexibleRegex(trimmedSearch);
    if (flexibleRegex && flexibleRegex.test(currentText)) {
      flexibleRegex.lastIndex = 0;
      const flexReplace = normReplace.trim();
      currentText = currentText.replace(flexibleRegex, () => flexReplace);
      applied.push({ search: trimmedSearch, replace: flexReplace });
      console.log(
        `[UniversalPatch] 空白弹性匹配生效: [${trimmedSearch.slice(0, 40)}${trimmedSearch.length > 40 ? '...' : ''}]`
      );
      continue;
    }

    misses.push({ search: normSearch, replace: normReplace });
  }

  // 第二遍：未命中的补丁做确定性归因
  let benignCount = 0;
  const errors: string[] = [];

  for (const miss of misses) {
    const trimmedReplace = miss.replace.trim();
    const trimmedSearch = miss.search.trim();

    // 规则 1：目标内容已被其它补丁写入
    if (
      options.tolerateAlreadyApplied &&
      trimmedReplace.length > 0 &&
      trimmedReplace !== trimmedSearch &&
      currentText.includes(trimmedReplace)
    ) {
      benignCount++;
      continue;
    }

    // 规则 2：等价于某条已生效的短替换补丁
    const explainedBySubstitution = applied.some(
      ({ search: s, replace: r }) =>
        s.length <= 8 &&
        s !== r &&
        miss.search.includes(s) &&
        miss.replace === miss.search.split(s).join(r)
    );
    if (explainedBySubstitution) {
      benignCount++;
      continue;
    }

    const preview = miss.search.length > 40 ? miss.search.slice(0, 40) + '...' : miss.search;
    errors.push(`补丁未找到匹配的原文字符串: [${preview}]`);
  }

  return {
    success: errors.length === 0,
    resultText: currentText,
    appliedCount: applied.length,
    benignCount,
    errors,
  };
}

/**
 * 针对 JSON 文件的安全字符串补丁执行器 (含刚性语法校验与原子落盘)
 * 单文件模式保留，内部复用两阶段提交，行为与历史版本一致。
 */
export function applyJsonStringPatch(
  filePath: string,
  patches: Array<{ search: string; replace: string }>
): { success: boolean; updatedObject?: any; summary?: string; error?: string } {
  const res = applyJsonStringPatchesAtomic([
    { fileName: filePath, filePath, patches },
  ]);
  if (!res.success || !res.files.length) {
    return { success: false, error: res.error || '字符串补丁校验未通过' };
  }
  return {
    success: true,
    updatedObject: res.files[0].updatedObject,
    summary: `成功应用 ${res.files[0].appliedCount} 处字符串补丁，未涉及字段 100% 保持稳定`,
  };
}

/** 多文件补丁分组 */
export interface FilePatchGroup {
  fileName: string;
  filePath: string;
  patches: Array<{ search: string; replace: string }>;
}

/** 多文件原子提交结果 */
export interface AtomicPatchResult {
  success: boolean;
  files: Array<{
    fileName: string;
    filePath: string;
    updatedObject: any;
    appliedCount: number;
    /** 已被其它补丁覆盖、判定为良性冗余的补丁数 */
    benignCount: number;
  }>;
  error?: string;
  errors: string[];
}

/**
 * 多文件两阶段原子提交 (Multi-File Two-Phase Commit)
 *
 * 阶段一（内存）：逐文件应用补丁 → 全部命中 → 全部 JSON.parse 通过
 * 阶段二（磁盘）：任一文件有任一补丁未命中，整体不写；全部通过后才统一落盘
 * 写盘中途异常：按已写列表回滚原始内容，绝不留下半残状态
 */
export function applyJsonStringPatchesAtomic(groups: FilePatchGroup[]): AtomicPatchResult {
  const errors: string[] = [];
  const computed: Array<{
    group: FilePatchGroup;
    raw: string;
    resultText: string;
    appliedCount: number;
    benignCount: number;
    updatedObject: any;
  }> = [];

  for (const group of groups) {
    if (!group.patches?.length) continue;

    if (!fs.existsSync(group.filePath)) {
      errors.push(`${group.fileName}: 目标文件不存在 (${group.filePath})`);
      continue;
    }

    const raw = fs.readFileSync(group.filePath, 'utf-8');
    // 带上下文的窄补丁优先落地，宽补丁随后清扫剩余；重叠部分由容忍规则消化
    const orderedPatches = [...group.patches].sort((a, b) => b.search.length - a.search.length);
    const res = applyStringPatches(raw, orderedPatches, { tolerateAlreadyApplied: true });

    if (!res.success) {
      errors.push(`${group.fileName}: ${res.errors.join('; ')}`);
      continue;
    }

    let updatedObject: any;
    try {
      updatedObject = JSON.parse(res.resultText);
    } catch (err: any) {
      errors.push(`${group.fileName}: 补丁替换后 JSON 语法损坏 (${err.message})`);
      continue;
    }

    computed.push({
      group,
      raw,
      resultText: res.resultText,
      appliedCount: res.appliedCount,
      benignCount: res.benignCount,
      updatedObject,
    });
  }

  if (errors.length > 0) {
    return {
      success: false,
      files: [],
      errors,
      error: `多文件补丁整体拦截，未写入任何文件：${errors.join(' | ')}`,
    };
  }

  if (computed.length === 0) {
    return {
      success: false,
      files: [],
      errors: ['未产生可应用的补丁'],
      error: '未产生可应用的补丁，已拦截落盘',
    };
  }

  const written: typeof computed = [];
  try {
    for (const item of computed) {
      atomicWriteStringSync(item.group.filePath, item.resultText);
      written.push(item);
    }
  } catch (err: any) {
    for (const item of written) {
      try {
        atomicWriteStringSync(item.group.filePath, item.raw);
      } catch (rollbackErr: any) {
        console.error(
          `[UniversalPatch] 回滚失败 ${item.group.fileName}: ${rollbackErr.message}`
        );
      }
    }
    return {
      success: false,
      files: [],
      errors: [err.message],
      error: `写盘失败，已回滚 ${written.length} 个文件: ${err.message}`,
    };
  }

  return {
    success: true,
    files: computed.map((c) => ({
      fileName: c.group.fileName,
      filePath: c.group.filePath,
      updatedObject: c.updatedObject,
      appliedCount: c.appliedCount,
      benignCount: c.benignCount,
    })),
    errors: [],
  };
}

/**
 * 阶段一：只做「读原文 + 让大模型推演补丁清单」，不落盘、不改文件。
 * 拆出来是为了让微调管线能把最耗时的 LLM 调用单独放进一个 workflow step 里观测进度。
 */
export interface JsonStringPatchPlan {
  success: boolean;
  patches?: PlannedPatch[];
  summary?: string;
  error?: string;
}

export async function generateJsonStringPatchPlan(options: {
  jsonPath: string;
  userFeedback: string;
  stageName: string;
  projectId: string;
  llm: LLMService;
  extraContext?: string;
}): Promise<JsonStringPatchPlan> {
  const { jsonPath, userFeedback, stageName, projectId, llm, extraContext } = options;
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
      return { success: true, patches: patchRes.patches, summary: patchRes.summary };
    }
    return { success: false, error: '大模型未生成有效补丁清单' };
  } catch (err: any) {
    return { success: false, error: err.message || '字符串差量推演异常' };
  }
}

/**
 * 多文件补丁推演：一次调用横跨多个文本产物
 *
 * 三条刚性约束：
 * 1. 每条补丁必须带 file，且必须命中传入的文件清单，否则整单拒绝（不做猜测兜底）；
 * 2. 超出上下文预算时，非主命中文件降级为骨架索引（明确降级，不是静默截断）；
 * 3. 推演结果原样返回给 apply 阶段做两阶段校验，本阶段绝不落盘。
 */
export async function generateMultiFilePatchPlan(options: {
  files: MultiFilePatchFile[];
  userFeedback: string;
  stageName: string;
  projectId: string;
  llm: LLMService;
  extraContext?: string;
}): Promise<JsonStringPatchPlan> {
  const { files, userFeedback, stageName, projectId, llm, extraContext } = options;

  if (!files.length) {
    return { success: false, error: '没有任何可修改的文本产物' };
  }

  const totalChars = files.reduce((acc, f) => acc + (f.content?.length || 0), 0);
  let effectiveFiles = files;

  if (totalChars > MULTI_FILE_PROMPT_BUDGET) {
    console.warn(
      `[UniversalPatch] 多文件上下文超预算 (${totalChars} > ${MULTI_FILE_PROMPT_BUDGET})，` +
        `非主命中文件降级为骨架索引`
    );
    effectiveFiles = files.map((f) =>
      f.isPrimary || !f.skeleton
        ? f
        : {
            ...f,
            content: `【该文件全文因上下文预算限制已省略，以下仅为骨架索引，禁止对其输出补丁】\n${f.skeleton}`,
          }
    );
  }

  const allowed = new Set(files.map((f) => f.fileName));
  const patchPrompt = buildMultiFilePatchPrompt(effectiveFiles, userFeedback, extraContext);

  try {
    const patchRes = await llm.generateObject<UniversalPatchOutput>(
      patchPrompt,
      UniversalPatchSchema,
      MULTI_FILE_PATCH_SYSTEM_PROMPT,
      { stage: stageName, projectId, temperature: 0.1 }
    );

    if (!patchRes || !Array.isArray(patchRes.patches) || patchRes.patches.length === 0) {
      return { success: false, error: '大模型未生成有效补丁清单' };
    }

    const missingFile = patchRes.patches.find((p) => !p.file || !allowed.has(p.file));
    if (missingFile) {
      return {
        success: false,
        error: `补丁缺少合法 file 归属: [${missingFile.file || '未填写'}]，单次修改不允许跨文件猜测`,
      };
    }

    return { success: true, patches: patchRes.patches, summary: patchRes.summary };
  } catch (err: any) {
    return { success: false, error: err.message || '多文件字符串差量推演异常' };
  }
}

/**
 * 高阶统一入口：针对已有 JSON 文件执行端到端字符串差量 Patch
 * 注：保留给单体调用路径；文本轨已统一走 generateMultiFilePatchPlan + applyJsonStringPatchesAtomic。
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

  const plan = await generateJsonStringPatchPlan({
    jsonPath,
    userFeedback,
    stageName,
    projectId,
    llm,
    extraContext,
  });
  if (!plan.success || !plan.patches) {
    return { success: false, error: plan.error || '大模型未生成有效补丁清单' };
  }

  const applyRes = applyJsonStringPatch(jsonPath, plan.patches);
  if (applyRes.success && applyRes.updatedObject) {
    const patchedObject = applyRes.updatedObject as T;
    if (onSuccess) {
      onSuccess(patchedObject);
    }
    return {
      success: true,
      data: patchedObject,
      summary: plan.summary || applyRes.summary,
    };
  }
  return { success: false, error: applyRes.error || '字符串补丁校验未通过' };
}
