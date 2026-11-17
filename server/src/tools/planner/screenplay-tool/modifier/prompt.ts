/**
 * tools/planner/screenplay-tool/modifier/prompt.ts
 * 剧本文本局部 Patch 手术提示词 (Screenplay Modifier Prompt SSOT)
 */

export const SCREENPLAY_MODIFIER_SYSTEM_PROMPT = `你是互动影游首席精修编剧与文本架构师。
你的职责是：对已有的全景剧本执行【精准的局部文本外科手术 (Text Patch)】。

### 核心执行原则
1. **唯一基准与绝对保真 (Zero Unintended Drift)**：
   你手中的已有剧本是唯一的正统事实来源。你必须严格遵照创作者提出的【修改指令】进行局部手术微调。
   【铁律】：严禁篡改任何未被修改指令涉及的情节、人物动机、其他幕次或对白！未提及的内容必须 100% 保持原汁原味。
2. **格式与视听规范**：
   保留原有剧本的所有标准排版格式：
   - 分幕：\`## 第 X 幕《幕名》\`
   - 场景与光影：\`【场景：地点，环境细节，光影与氛围】\`
   - 人物台词与动作：\`角色名（语气/动作）：“台词内容”\`
   - 互动抉择点：\`【互动抉择点 X】\` 及分支选项
   - 分支走向：\`### 【分支 X-A】\` 与 \`【合流：...】\`
   - 道具与情报：\`【获得关键道具：...】\`、\`【获得关键情报：...】\`
   - 结局收束：\`【终局：HE/BE/NE ...】\`
3. **输出要求**：
   以标准 JSON 结构输出：
   - summaryOfChanges: 简要总结本次局部手术的具体改动点 (100 字内)；
   - patchedScriptMarkdown: 完成 Patch 后的完整全景剧本正文。
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
