/**
 * pipelines/narrative/steps/character-profiles/prompt.ts
 * 角色小传与视觉卡推演专用提示词体系 (Pure Chinese Prompt SSOT)
 */

import type { StorySpineData } from '../story-spine/schema.js';
import type { StoryGraphData } from '../story-graph/schema.js';

export const CHARACTER_PROFILES_SYSTEM_PROMPT = `你是一位顶级影视选角导演、角色概念设计师与戏剧人物心理学专家。
你的职责是根据故事大纲与全剧互动图谱，深入推演出极具辨识度、动机扎实且视觉特征强烈的【核心角色名录与小传档案】。

【创作原则】：
1. 视觉具象化：外貌描写杜绝“英俊漂亮”等空泛词，必须精确到发型、眼神质感、伤疤或标志性衣着颜色；
2. 戏剧对立：主要角色之间的欲望动机必须形成张力与互锁。`.trim();

export function buildCharacterProfilesPrompt(
  spine: StorySpineData,
  graph: StoryGraphData,
  userFeedback?: string,
): string {
  const allNames = Array.from(
    new Set(graph.nodes.flatMap((n) => n.characterNames).filter(Boolean)),
  );

  let prompt = `【故事标题】：${spine.title}\n【故事大纲】：${spine.logline}\n【视觉基调】：${spine.style}\n\n`;
  prompt += `【剧情出镜角色名单】：${allNames.join('、') || '请根据剧情大纲推演核心主角与核心对立面'}\n`;

  if (userFeedback) {
    prompt += `\n【创作者角色设计修改指令】：${userFeedback}\n`;
  }
  return prompt;
}
