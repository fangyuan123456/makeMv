/**
 * modifier/steps/image/character-portrait/prompt.ts
 * 角色定妆「精修」提示词模板 (Modifier Prompt SSOT)
 *
 * 为什么在修改轨而不是生成轨：
 * 这套提示词只服务于「在既有角色设定上做语义级融合重写」，生成轨从不使用。
 * 它原本放在 generator/steps/character-portrait/prompt.ts 里，属于职责错置，现迁回修改轨。
 */

export const REFINE_CHARACTER_SYSTEM_PROMPT =
  `你是一位资深角色概念设计师与提示词微调专家。
你的任务是将创作者提出的最新微调指令，精准无缝地融入到已有角色的视觉设定中，进行语义级的自愈重写。
严格禁止生硬拼接，必须在保持角色既有人设底色、物种与骨架特征的前提下，根据创作者指令精修面容、服饰、道具或神态，生成崭新的电影级纯中文生图提示词。`;

export function buildRefineCharacterPrompt(
  character: any,
  userFeedback: string,
  style: string,
  userConstraints?: string[]
): string {
  let prompt = `【统一影视风格】：${style}\n`;
  if (userConstraints && userConstraints.length > 0) {
    prompt += `【创作者刚性偏好与禁忌红线 (绝对禁止违反)】：\n${userConstraints.map((c) => `- 🚫 ${c}`).join('\n')}\n\n`;
  }
  prompt += `【当前角色原始设定】：
- 姓名：${character.name}
- 身份定位：${character.role || '核心人物'}
- 既有外貌描写：${character.appearance || '暂无'}
- 既有视觉提示词：${character.visualPrompt || '暂无'}

【创作者微调精修指令】：
${userFeedback}

请结合创作者指令对该角色的视觉提示词进行语义级融合重写，输出一条焕然一新的【纯中文电影级定妆生图提示词】。`;
  return prompt;
}
