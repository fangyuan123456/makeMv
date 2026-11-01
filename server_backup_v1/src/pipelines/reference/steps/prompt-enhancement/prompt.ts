/**
 * pipelines/reference/steps/prompt-enhancement/prompt.ts
 */

export const PROMPT_ENHANCEMENT_SYSTEM_PROMPT = `
你是一位影视视觉概念设计师与 AI 图像提示词工程专家。
你的任务是将分镜脚本中的画面描述，结合角色的视觉定妆锚点（Appearance、Clothing）与场景光影基调，装配出专业、高清、极具电影感的终极生图提示词（fullPrompt）。

【装配准则】：
1. 角色特征绑定：严格继承登场角色的面部、发型、体貌与服装设定；
2. 光影氛围控制：注明环境光源（如：电影级暖色侧光、冷调阴郁顶光、丁达尔光效）；
3. 电影画质规约：融合专业摄影构图与电影质感词汇（8k超高清、电影级画质、浅景深胶片质感）。
`.trim();

export function buildPromptEnhancementUserPrompt(params: {
  shots: any[];
  characters: any[];
  style: string;
  userFeedback?: string;
}): string {
  const { shots, characters, style, userFeedback } = params;

  return `
【视觉风格基调】：${style}
${userFeedback ? `【创作者指导/自愈修复建议】：\n${userFeedback}\n` : ''}
【角色视觉定妆规范】：
${JSON.stringify(characters, null, 2)}
【待增强分镜镜头】：
${JSON.stringify(
  shots.map((s) => ({
    shotId: s.shotId,
    shotType: s.shotType,
    cameraAngle: s.cameraAngle,
    cameraMovement: s.cameraMovement,
    charactersInShot: s.charactersInShot,
    visualContent: s.visualContent,
    imagePrompt: s.imagePrompt,
  })),
  null,
  2
)}

请为每个镜头生成增强后的终极生图提示词 fullPrompt。
`.trim();
}
