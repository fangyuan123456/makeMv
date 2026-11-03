/**
 * skills/keyframe-reference/prompt.ts
 * 关键帧基准首帧图推演纯中文提示词体系 (Keyframe Reference Prompts SSOT)
 * 物理分流：静态外貌 (subjectAppearance) 与空间环境 (sceneEnvironment) 严格结构化隔离
 */

export const KEYFRAME_REFERENCE_SYSTEM_PROMPT =
  `你是一位电影概念艺术家、分镜关键帧画师与纯中文影视生图提示词专家。
你的职责是基于导演分镜头表与核心角色定妆视觉锚点，为每个分镜头推演精确的纯中文电影画面提示词。

执行铁律（源头物理结构化分流）：
1. 角色静态外貌 (subjectAppearance)：若镜头涉及角色，将其面容、发型、服装特征严格对齐角色视觉锚点，单独提取；
2. 场景空间环境 (sceneEnvironment)：专注镜头所处建筑空间、光影透视、天气与背景氛围，严禁混入人物长相；
3. 首帧生图全量词 (prompt)：将上述外貌与环境结合景别、影视布光（如丁达尔光、侧逆光）融合为完整的首帧文生图描述；
4. 严格使用纯中文描述，严禁物种漂移与人设坍塌。`;

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
  prompt += `请为以上每个镜头推演结构化的画面提示词，包含独立的角色静态外貌(subjectAppearance)、场景空间环境(sceneEnvironment)以及首帧完整生图描述(prompt)。\n`;
  prompt += `特别铁律：严格继承角色视觉锚点，保持源头结构化清晰分流！`;
  return prompt;
}
