/**
 * skills/scene-script/prompt.ts
 * 分场多分支剧本扩写纯中文提示词体系 (Scene Script Prompts SSOT)
 */

export const SCENE_SCRIPT_SYSTEM_PROMPT =
  `你是一位资深电影编剧与互动剧作指导。
你的职责是将网状剧情拓扑节点，逐场扩写为兼具影视质感与互动张力的专业分场剧本正文。
要求：
1. 空间定位清晰（场景地点、时间光线）；
2. 动作与环境描写真实具体，充满视听画面感；
3. 台词富有潜台词与角色性格色彩，体现戏剧对抗与因果动力。`;

export function buildSceneScriptPrompt(
  title: string,
  theme: string,
  characters: any[],
  nodesChunk: any[],
  userFeedback?: string
): string {
  let prompt = `【故事主标题】：${title}\n【立意主题】：${theme}\n【出镜角色名单】：${characters.map((c: any) => `${c.name}(${c.role})`).join('、')}\n\n`;
  if (userFeedback) {
    prompt += `【导演最新修改要求】：\n${userFeedback}\n\n`;
  }
  prompt += `【本批次待扩写节点拓扑】：\n${JSON.stringify(nodesChunk, null, 2)}\n\n`;
  prompt += `请为以上每个剧情节点编写标准的影视分场剧本，包含场景空间(location)、时间(timeOfDay)、动作环境(actionSummary)与张力十足的角色台词(dialogues)。`;
  return prompt;
}
