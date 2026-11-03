/**
 * skills/character-portrait/prompt.ts
 * 角色定妆视觉规范与纯中文微调提示词模板体系 (Character Portrait Prompts SSOT)
 */

export const CHARACTER_VISUAL_SPEC_SYSTEM_PROMPT =
  `你是一位资深电影视觉特效总监与角色概念设计师，专精于影视角色定妆视觉规范与纯中文影视级生图提示词工程。
你的职责是基于故事世界观基调与人物小传，为每位核心角色打造独一无二、细节拉满的纯中文定妆剧照提示词(visualPrompt)。
提示词必须具备强烈的影视画质质感、明确的面部五官特写、发型发丝光泽、服装剪裁细节、环境布光与摄影机景深。`;

export function buildCharacterVisualSpecPrompt(
  style: string,
  characters: any[],
  userFeedback?: string
): string {
  let prompt = `【影视风格基调】：${style}\n\n`;
  if (userFeedback) {
    prompt += `【导演最新微调与特殊指令】：\n${userFeedback}\n\n`;
  }
  prompt += `【全剧核心角色小传档案】：\n${JSON.stringify(characters, null, 2)}\n\n`;
  prompt += `请为以上每位角色设计出最能彰显人物性格与外貌特征的【纯中文电影级定妆生图提示词 (visualPrompt)】。\n`;
  prompt += `格式要求：包含特写景别、面部特征细部、发型神态、服饰材质触感、大师级电影布光与相机镜头感，严格使用纯中文描述。`;
  return prompt;
}

export const REFINE_CHARACTER_SYSTEM_PROMPT =
  `你是一位资深角色概念设计师与提示词微调专家。
你的任务是将创作者提出的最新微调指令，精准无缝地融入到已有角色的视觉设定中，进行语义级的自愈重写。
严格禁止生硬拼接，必须在保持角色既有人设底色、物种与骨架特征的前提下，根据创作者指令精修面容、服饰、道具或神态，生成崭新的电影级纯中文生图提示词。`;

export function buildRefineCharacterPrompt(
  character: any,
  userFeedback: string,
  style: string
): string {
  return `【统一影视风格】：${style}
【当前角色原始设定】：
- 姓名：${character.name}
- 身份定位：${character.role || '核心人物'}
- 既有外貌描写：${character.appearance || '暂无'}
- 既有视觉提示词：${character.visualPrompt || '暂无'}

【创作者微调精修指令】：
${userFeedback}

请结合创作者指令对该角色的视觉提示词进行语义级融合重写，输出一条焕然一新的【纯中文电影级定妆生图提示词】。`;
}
