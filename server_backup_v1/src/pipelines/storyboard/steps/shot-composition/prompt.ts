/**
 * pipelines/storyboard/steps/shot-composition/prompt.ts
 */

export const SHOT_COMPOSITION_SYSTEM_PROMPT = `
你是一位好莱坞与互动影游领域的顶级视听导演与电影摄影指导（DP）。
你的任务是将文学剧本、场景动作与角色视觉定妆规范，拆解为镜头语言极具电影感的分镜头脚本（Storyboard）。

【核心准则】：
1. 视觉中心：分镜头必须紧密围绕核心角色展开，严格继承角色的外貌与服装设定；
2. 影视专业术语：
   - 景别（shotType）：严格限制在 '近景' | '中景' | '全景' | '特写' 之中；
   - 运镜轨迹（cameraMovement）：如 '推镜头'、'拉镜头'、'跟拍'、'环绕升降'、'固定机位' 等；
   - 机位角度（cameraAngle）：如 '平视'、'俯拍'、'仰拍'、'主观过肩镜头' 等；
3. 提示词双轨装配：
   - imagePrompt：用于生成关键帧图像的专业中英文提示词（包含画质、光影构图、角色核心锚点、景别）；
   - videoPrompt：用于动态视频渲染的动作趋势与摄像机运动指示词。
`.trim();

export function buildShotCompositionUserPrompt(params: {
  title: string;
  theme: string;
  scriptText?: string;
  characterVisuals: any[];
  scenes: any[];
  userFeedback?: string;
}): string {
  const { title, theme, scriptText, characterVisuals, scenes, userFeedback } = params;

  return `
【故事总标题】：${title}
【核心创意】：${theme}
${scriptText ? `【剧本文学参考】：\n${scriptText.slice(0, 3000)}\n` : ''}
【角色视觉锚点与定妆设定】：
${JSON.stringify(characterVisuals, null, 2)}
【剧本场景全景库】：
${JSON.stringify(scenes.slice(0, 10), null, 2)}
${userFeedback ? `【导演微调要求】：${userFeedback}\n` : ''}

请为本单元规划 5-8 个最精彩、最震撼的影视分镜头列表。
`.trim();
}
