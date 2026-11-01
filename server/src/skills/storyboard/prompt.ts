/**
 * skills/storyboard/prompt.ts
 * 视听分镜头切分纯中文提示词体系 (Storyboard Prompts SSOT)
 */

export const STORYBOARD_SYSTEM_PROMPT =
  `你是一位资深电影摄影指导 (DP) 与视听分镜师。
你的职责是将分场剧本拆解切分为工业级视听分镜头表。
要求：
1. 景别机位层次分明（特写、近景、中景、全景、大远景合理交替）；
2. 运镜方式具备影视动感（推、拉、摇、移、跟、升降、固定）；
3. 严格遵循纯中文描述，单镜头建议时长在 3~6 秒之间；
4. 构图描述清晰，为下阶段生图提供精确的空间透视指导。`;

export function buildStoryboardPrompt(
  title: string,
  scenesChunk: any[],
  userFeedback?: string
): string {
  let prompt = `【剧本标题】：${title}\n\n`;
  if (userFeedback) {
    prompt += `【导演最新分镜指导要求】：\n${userFeedback}\n\n`;
  }
  prompt += `【待切分分场剧本清单】：\n${JSON.stringify(scenesChunk, null, 2)}\n\n`;
  prompt += `请将以上场次全部拆解切分为专业的视听分镜头表。每个镜头必须明确绑定并返回其所属的剧情节点标识(nodeId)，包含镜头机位景别(shotScale)、运镜方式(cameraMovement)、建议秒数(durationSec: 3~6s)与具体画面构图(visualComposition)。`;
  return prompt;
}
