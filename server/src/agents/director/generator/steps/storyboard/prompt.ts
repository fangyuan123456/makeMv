/**
 * agents/pipeline/workflows/steps/storyboard/prompt.ts
 * 视听分镜头切分纯中文提示词体系 (Storyboard Prompts SSOT)
 */

export const STORYBOARD_SYSTEM_PROMPT =
  `你是一位顶级电影摄影指导 (Director of Photography) 与视听分镜大师。
你的职责是将分场剧本拆解切分为好莱坞工业级的视听分镜头表。

核心执行规范（OpenMontage 五维摄影法则）：
1. 景别层次分明 (shotScale)：特写、近景、中景、全景、大远景严谨交替，赋予视听节奏感；
2. 物理运镜轨迹 (cameraTrajectory)：严禁使用“镜头微动”等模糊词汇，必须输出专业物理轨迹（如“平稳向前推近至特写”、“顺时针弧形环绕45度”、“手持跟拍呼吸感晃动”）；
3. 主体时序微动 (subjectMotion)：杜绝僵硬静止，为每个镜头注入具有时间推移动势的角色微动作（如“先垂眼咬唇，第2秒猛然抬头，眼神由迷茫转为决绝”）；
4. 环境物理动态 (sceneDynamics)：描摹背景空气微粒、光线明暗滑移、雨水或烟雾流动；
5. 单镜头时长控制 (durationSec)：在 3~6 秒之间，兼顾叙事效率与视觉张力；
6. 严格输出符合 Schema 的纯中文结构化 JSON 数据。`;

export function buildStoryboardPrompt(
  title: string,
  scenesChunk: any[],
  userFeedback?: string,
  userConstraints?: string[]
): string {
  let prompt = `【剧本标题】：${title}\n\n`;
  if (userConstraints && userConstraints.length > 0) {
    prompt += `【创作者刚性偏好与禁忌红线 (绝对禁止违反)】：\n${userConstraints.map((c) => `- 🚫 ${c}`).join('\n')}\n\n`;
  }
  if (userFeedback) {
    prompt += `【导演最新分镜指导要求】：\n${userFeedback}\n\n`;
  }
  prompt += `【待切分分场剧本清单】：\n${JSON.stringify(scenesChunk, null, 2)}\n\n`;
  prompt += `请将以上场次全部拆解切分为专业的视听分镜头表。每个镜头必须明确绑定并返回其所属的剧情节点标识(nodeId)，包含镜头机位景别(shotScale)、摄影机运镜动感(cameraMovement)、专业物理轨迹(cameraTrajectory)、主体时序微动作(subjectMotion)、环境光影动态(sceneDynamics)、建议秒数(durationSec: 3~6s)与具体画面构图(visualComposition)。`;

  /*
   * 出镜角色必须逐镜登记，这是「改了某角色要重做哪几段视频」的唯一依据。
   * 不写的话，下游只能按剧情节点粗算——同一节点里的空镜也会被算成受影响，
   * 白花重渲的钱。允许空数组（纯环境空镜），但不能省略字段。
   */
  prompt += `\n\n【强制字段 characterNames】：每个镜头都必须返回 characterNames 数组，列出该镜头画面里实际出镜的角色姓名（严格取自剧本中出现的人物名，不得新造、不得用「主角」「她」等代词）。若该镜头是纯环境空镜或无人物出镜，返回空数组 []。此字段不可省略、不可填 null。`;
  return prompt;
}
