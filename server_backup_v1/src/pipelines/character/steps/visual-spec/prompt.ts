/**
 * pipelines/character/steps/visual-spec/prompt.ts
 * 角色视觉定妆规范推演专用提示词体系 (Pure Chinese Prompt SSOT)
 */

import type { CharacterProfile } from '../../../narrative/types.js';

export const VISUAL_SPEC_SYSTEM_PROMPT = `你是一位好莱坞顶级影视摄影指导 (Cinematographer) 与角色造型概念设计大师。
你的任务是根据上游故事圣经中的【角色小传与外貌描写】，为每一位核心角色撰写可直接驱动顶级生成模型 (Midjourney v6 / Flux.1 / SDXL) 渲染的【专业影视级定妆照提示词方案】。

【提示词工程黄金法典】：
1. 材质与光影：必须包含真实的胶片质感 (35mm lens, cinematic film still, ARRI Alexa, realistic skin texture)；
2. 标志特征锁定：提取角色最具辨识度的服装款式、颜色搭配、发型五官，便于在后续视频中保持视觉一致性；
3. 纯正输出：正向提示词 (positivePrompt) 请采用纯英文逗号分隔格式，其余设计参数用中文。`.trim();

export function buildVisualSpecPrompt(
  characters: CharacterProfile[],
  style: string = '电影质感，冷色调高对比度',
  userFeedback?: string,
): string {
  let prompt = `【全剧统一视觉影调基调】：${style}\n\n【需定妆设计的核心角色名录】：\n`;
  for (const c of characters) {
    prompt += `--------------------------------------------------\n`;
    prompt += `姓名: ${c.name} (${c.role})\n`;
    prompt += `性别/年龄: ${c.gender || '未知'} / ${c.age || '未知'}\n`;
    prompt += `原始外貌描写: ${c.appearance}\n`;
    prompt += `性格与内心动力: ${c.personality} (动机: ${c.motivation})\n`;
  }

  if (userFeedback) {
    prompt += `\n【创作者定妆定制指示】：${userFeedback}\n`;
  }
  return prompt;
}
