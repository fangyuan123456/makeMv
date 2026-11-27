/**
 * tools/planner/screenplay-tool/modifier/prompt.ts
 * 剧本文本局部 Patch 手术提示词 (Screenplay Modifier Prompt SSOT)
 */

import { getSkillPrompt } from '../../../../skills/index.js';

export const STRUCTURED_SCREENPLAY_PATCH_SYSTEM_PROMPT = `你是互动影游首席精修编剧与文本架构师。
你的职责是：对结构化分幕剧本执行【精准的局部增量修改 (Structured Patch)】。

### 核心执行原则
1. **增量修改、零连带漂移**：
   - 系统已将剧本拆分为结构化的分幕正文（\`acts\`）与终局文案（\`endings\`），**分支选项、走向箭头、\`【互动抉择点】\` 与 \`### 【互动钩子】\` 将由系统代码自动重拼，你绝对不要在文本中手写这些标记**。
   - **只输出需要修改的幕次（\`actPatches\`）和需要修改的终局（\`endingPatches\`）**！未涉及的幕次与终局**不要输出**，系统会 100% 原封不动保留。
2. **忽略违背拓扑的错误指令**：
   - 如果修改指令中混入了“把某个终局改为推进主线”或“让最后一幕推进主线”的要求，直接忽略该错误指令，只修正合理的戏剧动作、防剧透起幅、跨幕承接或定格画面描写。
3. **跨幕承接与防剧透**：
   - 跨幕承接补写只改在**下一幕（第 N+1 幕）的开篇正文**；
   - 幕末必须停在互动触发前的悬念起幅瞬间，绝不提前写出互动完成后的结果。
4. **遵循 AI 互动抉择剧本规范**：
   所有新增或修改的文本必须严格满足下方 \`ai-interactive-screenplay\` 规范。

${getSkillPrompt('ai-interactive-screenplay')}
`;

export function buildStructuredScreenplayPatchPrompt(params: {
  acts: Array<{ actNumber: number; sceneHeader: string; narrativeBody: string }>;
  endings: Array<{ actNumber: number; outcomeKey: string; endingTitle: string; endingType: string; narrativeText: string }>;
  instruction: string;
  targetAct?: number;
  outlineAnchor?: string;
}): string {
  const { acts, endings, instruction, targetAct, outlineAnchor } = params;

  const actsBlock = acts
    .map((a) => `#### 第 ${a.actNumber} 幕（当前场景：${a.sceneHeader}）\n${a.narrativeBody}`)
    .join('\n\n');

  const endingsBlock =
    endings.length > 0
      ? endings
          .map(
            (e) =>
              `- [第 ${e.actNumber} 幕 | outcomeKey=${e.outcomeKey}] 《${e.endingTitle}（${e.endingType}）》：${e.narrativeText}`
          )
          .join('\n')
      : '（无）';

  const actConstraint = targetAct
    ? `\n【重点提示】：创作者明确指定重点针对【第 ${targetAct} 幕】进行修改，其他各幕请勿输出在 actPatches 中。\n`
    : '';

  const anchorBlock = outlineAnchor
    ? `\n### 【原始大纲拓扑基准（只读参考，由系统代码自动拼装，禁止擅改去向）】\n${outlineAnchor}\n`
    : '';

  return `### 【局部修改指令 (Patch Instruction)】
${instruction}
${actConstraint}${anchorBlock}
### 【当前各幕纯戏剧正文（Acts）】
${actsBlock}

### 【当前各终局定格文案（Endings）】
${endingsBlock}

请严格按 \`StructuredScreenplayPatchOutputSchema\` 只输出需要改动的那几项 \`actPatches\` / \`endingPatches\` 与 \`summaryOfChanges\`（未改动的幕与终局请勿输出）。`;
}
