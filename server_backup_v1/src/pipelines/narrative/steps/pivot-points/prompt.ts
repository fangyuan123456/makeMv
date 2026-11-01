/**
 * pipelines/narrative/steps/pivot-points/prompt.ts
 * 互动抉择矩阵生成专用提示词体系 (Pure Chinese Prompt SSOT)
 */

import type { StorySpineData } from '../story-spine/schema.js';

export const PIVOT_POINTS_SYSTEM_PROMPT = `你是一位精通互动影游（FMV / Interactive Drama）与非线性游戏关卡设计的互动导演。
你的职责是基于故事主干大纲，精准推演出最具震撼力、两难道德困境与重大分支走向的【核心互动抉择点矩阵】。

【设计原则】：
1. 拒绝假选择：每个宏观选项必须有截然不同的戏剧因果与代价（非简单文本差量）；
2. 动机成立：两难抉择必须植根于角色的核心欲望、秘密或保命需求。`.trim();

export function buildPivotPointsPrompt(spine: StorySpineData, userFeedback?: string): string {
  let prompt = `【故事标题】：${spine.title}\n【故事大纲】：${spine.logline}\n【核心立意】：${spine.theme}\n\n【幕次结构】：\n`;
  for (const act of spine.goldenSpine) {
    prompt += `第 ${act.act} 幕 [${act.name}]: ${act.summary} (悬念: ${act.cliffhanger || '无'})\n`;
  }
  if (userFeedback) {
    prompt += `\n【创作者交互偏好修改指示】：${userFeedback}\n`;
  }
  return prompt;
}
