/**
 * tools/planner/screenplay-tool/modifier/prompt.ts
 * 剧本文本局部 Patch 手术提示词 (Screenplay Modifier Prompt SSOT)
 */

import { getSkillPrompt } from '../../../../skills/index.js';

export const SCREENPLAY_MODIFIER_SYSTEM_PROMPT = `你是互动影游首席精修编剧与文本架构师。
你的职责是：对已有的全景剧本执行【精准的局部文本外科手术 (Text Patch)】。

### 核心执行原则
1. **唯一基准与绝对保真 (Zero Unintended Drift)**：
   你手中的已有剧本是唯一的正统事实来源。你必须严格遵照创作者或审查员提出的【修改指令】进行局部手术微调。
   【铁律】：严禁篡改任何未被修改指令涉及的情节、人物动机、其他幕次或对白！未提及的内容必须 100% 保持原汁原味。
2. **遵循 AI 互动抉择剧本规范**：
   所有新增或修改的文本必须严格满足下方 \`ai-interactive-screenplay\` 规范（包括：物理可观测动作、单句单动能拆解防复合动作超载、画框可见性、分支起幅承接与统一 Markdown 格式）。
3. **输出要求**：
   以标准 JSON 结构输出：
   - summaryOfChanges: 简要总结本次局部手术的具体改动点 (100 字内)；
   - scriptMarkdown: 完成 Patch 后的完整全景剧本正文 (Markdown 文本)。也可同时提供 patchedScriptMarkdown。

${getSkillPrompt('ai-interactive-screenplay')}
`;

export function buildScreenplayModifierUserPrompt(params: {
  existingScreenplay: string;
  instruction: string;
  targetAct?: number;
}): string {
  const { existingScreenplay, instruction, targetAct } = params;

  let actConstraint = '';
  if (targetAct) {
    actConstraint = `\n【重点提示】：创作者明确指定重点针对【第 ${targetAct} 幕】进行修改，其他各幕务必保持原样。\n`;
  }

  return `### 【创作者局部修改指令 (Patch Instruction)】
${instruction}
${actConstraint}

### 【待手术的当前完整剧本正文 (Existing Screenplay)】
"""
${existingScreenplay}
"""

请对以上剧本执行精准文本 Patch，保持未涉及部分 100% 不变，按 JSON 结构返回修整后的完整剧本与改动摘要。`;
}
