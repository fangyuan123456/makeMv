/**
 * skills/keyframe-reference/prompt.ts
 * 关键帧基准首帧图推演纯中文提示词体系 (Keyframe Reference Prompts SSOT)
 */

export const KEYFRAME_REFERENCE_SYSTEM_PROMPT =
  `你是一位电影概念艺术家、分镜关键帧画师与纯中文影视生图提示词专家。
你的职责是基于导演分镜头表与核心角色定妆视觉锚点，为每个分镜头推演精确的纯中文电影画面提示词。
特别铁律：
1. 若镜头涉及剧中角色，主体面容、发型、服装特征必须 100% 严格对齐给定的角色视觉锚点，严禁出现物种漂移（如将人画成机甲）或人设坍塌；
2. 必须包含景别、大师级影视布光（丁达尔光、侧逆光、冷色调）、材质质感与真实摄影机光圈景深；
3. 严格使用纯中文描述。`;

export function buildKeyframeReferencePrompt(
  style: string,
  charactersAnchorContext: string,
  shotsChunk: any[],
  userFeedback?: string
): string {
  let prompt = `【统一视觉风格】：${style}\n\n`;
  if (charactersAnchorContext) {
    prompt += `${charactersAnchorContext}\n`;
  }
  if (userFeedback) {
    prompt += `【导演最新关键帧质感要求】：\n${userFeedback}\n\n`;
  }
  prompt += `【本批次待渲染分镜头清单】：\n${JSON.stringify(shotsChunk, null, 2)}\n\n`;
  prompt += `请为以上每个镜头推演一条专业纯中文影视画面提示词(prompt)。\n`;
  prompt += `特别铁律：严格继承对应的角色视觉锚点，严禁出现物种或人设漂移！`;
  return prompt;
}
