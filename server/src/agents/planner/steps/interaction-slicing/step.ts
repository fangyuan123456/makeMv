/**
 * agents/planner/steps/interaction-slicing/step.ts
 * 互动切口与物理分段工序 (sliceInteractionsStep)
 *
 * 极简三段式闭环：
 * 1. Patch 插入互动标签：只输出 insertAfter 锚点，原位插入 <interact> 标签；
 * 2. 代码物理分段：按标签直接切开剧本，100% 保留原文一字不丢；
 * 3. 实现互动内容与玩法：基于各标签前后已经切好的文本，专职生成玩法、提示与分支选项。
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { asyncPool } from '../../../../utils/async-pool.js';
import { config } from '../../../../utils/config.js';
import { STAGE, PLANNER_STEP } from '../../../../project-store/artifact-fs.js';
import {
  SliceInteractionsInputSchema,
  SliceInteractionsOutputSchema,
  InteractionTagPatchPlanSchema,
  ActionGameplayOutputSchema,
  ChoiceGameplayOutputSchema,
  type SliceInteractionsInput,
  type SliceInteractionsOutput,
  type InteractionTagPatch,
  type InteractionTagPatchPlan,
  type ActionGameplayOutput,
  type ChoiceGameplayOutput,
  type SlicedClipNode,
  type ClipInteraction,
} from './schema.js';
import {
  buildInteractionTagPatchSystemPrompt,
  buildInteractionTagPatchUserPrompt,
  buildInteractionGameplaySystemPrompt,
  buildSingleTagGameplayUserPrompt,
  type TaggedSegmentContext,
} from './prompt.js';

export interface AppliedTagPatch {
  tagId: string;
  clipTitle: string;
  category: 'ACTION' | 'CHOICE';
  intentHint?: string;
  offset: number;
}

export interface TaggedSpineSplitResult {
  taggedScript: string;
  segments: string[];
  appliedTags: AppliedTagPatch[];
}

const CLOSING_PUNCT = new Set(['”', '’', '）', ')', '」', '』', '》', '】', '"']);
const TERMINAL_PUNCT = new Set(['。', '！', '？', '!', '?']);

function snapPastClosingPunctuation(text: string, rawEnd: number, needle: string): number {
  let pos = rawEnd;
  const trimmedNeedle = needle.trimEnd();
  const endsWithTerminal =
    trimmedNeedle.length > 0 && TERMINAL_PUNCT.has(trimmedNeedle[trimmedNeedle.length - 1]);

  while (pos < text.length) {
    const ch = text[pos];
    if (CLOSING_PUNCT.has(ch) || (!endsWithTerminal && (TERMINAL_PUNCT.has(ch) || ch === '…'))) {
      pos++;
      continue;
    }
    if (text.slice(pos, pos + 2) === '**') {
      const lineStart = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
      const openBoldCount = text.slice(lineStart, pos).split('**').length - 1;
      if (openBoldCount % 2 === 1) {
        pos += 2;
        continue;
      }
    }
    break;
  }
  return pos;
}

function normalizeForAnchorSearch(s: string): { norm: string; rawEndIndices: number[] } {
  const normChars: string[] = [];
  const rawEndIndices: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/[\s“”‘’"'（）()—…\-,.!?;:，。！？、；：]/.test(ch)) continue;
    normChars.push(ch);
    rawEndIndices.push(i + 1);
  }
  return { norm: normChars.join(''), rawEndIndices };
}

/**
 * 在 spineScript[searchFrom..] 中定位 insertAfter 锚点文本的结束字符偏移量。
 * 优先级：精确原串匹配 -> 去空白与标点归一化匹配 -> 尾部唯一短语兜底。
 */
export function locateAnchorEndOffset(
  spineScript: string,
  searchFrom: number,
  insertAfter: string
): number {
  const needle = (insertAfter || '').trim();
  if (!needle || searchFrom >= spineScript.length) return -1;

  const exactIdx = spineScript.indexOf(needle, searchFrom);
  if (exactIdx !== -1) {
    return snapPastClosingPunctuation(spineScript, exactIdx + needle.length, needle);
  }

  const tailSlice = spineScript.slice(searchFrom);
  const hay = normalizeForAnchorSearch(tailSlice);
  const normNeedle = normalizeForAnchorSearch(needle).norm;
  if (!normNeedle) return -1;

  let normIdx = hay.norm.indexOf(normNeedle);
  let matchedNormLen = normNeedle.length;

  if (normIdx === -1 && normNeedle.length > 10) {
    const tailNeedle = normNeedle.slice(-10);
    normIdx = hay.norm.indexOf(tailNeedle);
    matchedNormLen = tailNeedle.length;
  }

  if (normIdx === -1) return -1;
  const lastRawEnd = hay.rawEndIndices[normIdx + matchedNormLen - 1];
  if (typeof lastRawEnd !== 'number') return -1;

  return snapPastClosingPunctuation(spineScript, searchFrom + lastRawEnd, needle);
}

const INTERACT_TAG_REGEX = /\n*<interact\s+id="([^"]+)"\s+category="(ACTION|CHOICE)"\s*\/>\n*/g;

/**
 * 在原剧本对应锚点后原位插入 <interact> 标签，再严格按标签物理分段（保证原文一字不少）。
 */
export function applyInteractionTagPatches(
  spineScript: string,
  patches: InteractionTagPatch[]
): TaggedSpineSplitResult {
  const appliedTags: AppliedTagPatch[] = [];
  let cursor = 0;

  for (const patch of patches || []) {
    const offset = locateAnchorEndOffset(spineScript, cursor, patch.insertAfter);
    if (offset <= cursor || offset >= spineScript.length) continue;

    const beforeChunk = spineScript.slice(cursor, offset).trim();
    const remainChunk = spineScript.slice(offset).trim();
    if (!beforeChunk || !remainChunk) continue;

    appliedTags.push({
      tagId: patch.tagId?.trim() || `I${appliedTags.length + 1}`,
      clipTitle: patch.clipTitle?.trim() || `第 ${appliedTags.length + 1} 幕`,
      category: patch.category,
      ...(patch.intentHint?.trim() ? { intentHint: patch.intentHint.trim() } : {}),
      offset,
    });
    cursor = offset;
  }

  if (appliedTags.length === 0) {
    return {
      taggedScript: spineScript,
      segments: [spineScript.trim()],
      appliedTags: [],
    };
  }

  const parts: string[] = [];
  let prevOffset = 0;
  for (const tag of appliedTags) {
    parts.push(spineScript.slice(prevOffset, tag.offset).trim());
    parts.push(`<interact id="${tag.tagId}" category="${tag.category}" />`);
    prevOffset = tag.offset;
  }
  parts.push(spineScript.slice(prevOffset).trim());

  const taggedScript = parts.join('\n\n');
  const segments = splitScriptByInteractTags(taggedScript);

  return { taggedScript, segments, appliedTags };
}

/**
 * 纯物理按 <interact ... /> 标签分隔符拆出各段正文
 */
export function splitScriptByInteractTags(taggedScript: string): string[] {
  return taggedScript
    .split(new RegExp(INTERACT_TAG_REGEX.source))
    .filter((_, idx) => idx % 3 === 0)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function generateSingleTagInteraction(
  title: string,
  ctx: TaggedSegmentContext,
  gameplayAgent: Agent
): Promise<ClipInteraction> {
  const userPrompt = buildSingleTagGameplayUserPrompt({ title, context: ctx });
  if (ctx.category === 'ACTION') {
    const out = (await generateStructured({
      agent: gameplayAgent,
      prompt: userPrompt,
      schema: ActionGameplayOutputSchema,
      stage: STAGE.planner,
      step: PLANNER_STEP.slices,
      label: `玩法实现（ACTION / 标签 ${ctx.tagId}）`,
    })) as ActionGameplayOutput | undefined;
    if (!out?.actionType?.trim() || !out?.prompt?.trim()) {
      throw new Error(`[SliceInteractions] 标签 [${ctx.tagId}] 缺少合法的 ACTION 玩法实现`);
    }
    return {
      category: 'ACTION',
      actionType: out.actionType.trim(),
      prompt: out.prompt.trim(),
      feedback: out.feedback?.trim() || '交互完成',
    };
  }

  const out = (await generateStructured({
    agent: gameplayAgent,
    prompt: userPrompt,
    schema: ChoiceGameplayOutputSchema,
    stage: STAGE.planner,
    step: PLANNER_STEP.slices,
    label: `玩法实现（CHOICE / 标签 ${ctx.tagId}）`,
  })) as ChoiceGameplayOutput | undefined;
  if (!out?.mainlineChoice?.trim() || !out?.branchChoice?.trim()) {
    throw new Error(`[SliceInteractions] 标签 [${ctx.tagId}] 缺少合法的 CHOICE 玩法实现`);
  }
  return {
    category: 'CHOICE',
    cutId: `${ctx.clipId}.1`,
    conflictSummary: out.conflictSummary?.trim() || `${ctx.clipTitle}抉择`,
    mainlineChoice: out.mainlineChoice.trim(),
    branchChoice: out.branchChoice.trim(),
  };
}

/**
 * 创建专职交互导演 Agent（用于插入标签）与玩法设计 Agent（用于实现标签玩法）
 */
export function createInteractiveDirectorAgent(
  instructions: string = buildInteractionTagPatchSystemPrompt()
): Agent {
  return new Agent({
    name: 'interactive-director-agent',
    instructions,
    model: LLMProvider.getModel(),
  });
}

/**
 * 执行两阶段纯粹切片工序：
 * Step 2A: Patch 插入互动标签 -> 代码按标签物理分段
 * Step 2C: 为物理分段后的各互动标签实现具体玩法与内容
 */
export async function executeSliceInteractionsStep(
  input: SliceInteractionsInput,
  agent?: Agent
): Promise<SliceInteractionsOutput> {
  const { spineScript } = input;
  if (!spineScript || !spineScript.trim()) {
    return {
      title: '未命名短剧',
      clips: [
        {
          clipId: 'S1',
          level: 1,
          title: '主干全篇',
          narrativeText: spineScript || '',
          isEnding: true,
        },
      ],
    };
  }

  const patchAgent = agent || createInteractiveDirectorAgent(buildInteractionTagPatchSystemPrompt());
  const patchPrompt = buildInteractionTagPatchUserPrompt({ spineScript });
  const patchObject = (await generateStructured({
    agent: patchAgent,
    prompt: patchPrompt,
    schema: InteractionTagPatchPlanSchema,
    stage: STAGE.planner,
    step: PLANNER_STEP.slices,
    label: '互动切口切分',
  })) as InteractionTagPatchPlan | undefined;

  const patchPlan: InteractionTagPatchPlan = patchObject || {
    title: '未命名短剧',
    endingTitle: '终局收束',
    patches: [],
  };

  const title = patchPlan.title?.trim() || '未命名短剧';
  const { segments, appliedTags } = applyInteractionTagPatches(spineScript, patchPlan.patches || []);

  if (appliedTags.length === 0 || segments.length < 2) {
    return {
      title,
      clips: [
        {
          clipId: 'S1',
          level: 1,
          title: patchPlan.endingTitle?.trim() || title,
          narrativeText: spineScript.trim(),
          isEnding: true,
        },
      ],
    };
  }

  const contexts: TaggedSegmentContext[] = appliedTags.map((tag, idx) => ({
    tagId: tag.tagId,
    clipId: `S${idx + 1}`,
    clipTitle: tag.clipTitle,
    category: tag.category,
    ...(tag.intentHint ? { intentHint: tag.intentHint } : {}),
    beforeText: segments[idx],
    afterText: segments[idx + 1],
  }));

  const gameplayAgent = agent || createInteractiveDirectorAgent(buildInteractionGameplaySystemPrompt());
  const interactions = await asyncPool(
    Math.min(4, config.llm.maxConcurrency),
    contexts,
    (ctx) => generateSingleTagInteraction(title, ctx, gameplayAgent),
    'SliceInteractions'
  );

  const clips: SlicedClipNode[] = contexts.map((ctx, idx) => ({
    clipId: ctx.clipId,
    level: idx + 1,
    title: ctx.clipTitle,
    narrativeText: segments[idx],
    isEnding: false,
    interaction: interactions[idx],
  }));

  const endingLevel = clips.length + 1;
  clips.push({
    clipId: `S${endingLevel}`,
    level: endingLevel,
    title: patchPlan.endingTitle?.trim() || '终局收束',
    narrativeText: segments[segments.length - 1],
    isEnding: true,
  });

  return { title, clips };
}

/**
 * Mastra 官方原生 Step 实例
 */
export const sliceInteractionsStep = createStep({
  id: 'slice-interactions',
  inputSchema: SliceInteractionsInputSchema,
  outputSchema: SliceInteractionsOutputSchema,
  execute: async ({ context }) => {
    return await runTaskRecordedStep('slice-interactions', async () => {
      const ctx = (context as any) || {};
      const spineScript =
        ctx.spineScript ||
        ctx.steps?.['write-spine-script']?.output?.spineScript ||
        ctx.triggerData?.spineScript ||
        '';
      return await executeSliceInteractionsStep({ spineScript });
    });
  },
});
