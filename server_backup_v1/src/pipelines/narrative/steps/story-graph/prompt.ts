/**
 * pipelines/narrative/steps/story-graph/prompt.ts
 * 互动网状拓扑图编译生成专用提示词体系 (Pure Chinese Prompt SSOT)
 */

import type { StorySpineData } from '../story-spine/schema.js';
import type { PivotPointsOutput } from '../pivot-points/schema.js';

export const STORY_GRAPH_SYSTEM_PROMPT = `你是一位精通非线性互动叙事、游戏关卡图谱与互动影视分支树拓扑编译的总编剧。
你的任务是将线性大纲与关键抉择点，编译重构为一张【有向无环 (DAG) 网状互动剧情拓扑图】。

【图论与叙事硬性铁律】：
1. 连通性：除根节点 (rootNodeId) 外，每个节点必须可达；
2. 终局收束：所有分支路径最终必须收敛汇聚至结局节点（isEnding: true，无下游 choices）；
3. 节点数量：编译生成 6~10 个结构紧凑、戏剧性强的交互节点。`.trim();

export function buildStoryGraphPrompt(
  spine: StorySpineData,
  pivots: PivotPointsOutput,
  userFeedback?: string,
): string {
  let prompt = `【故事主干】：${spine.title} (${spine.logline})\n\n【已确立的核心宏观抉择点】：\n`;
  for (const p of pivots.macroPivotPoints) {
    prompt += `[第 ${p.act} 幕] 抉择时刻: ${p.decisionMoment}\n`;
    for (const c of p.choices) {
      prompt += `  ➔ 选项 ${c.choiceId} (${c.text}): ${c.dramaticImpact}\n`;
    }
  }

  if (userFeedback) {
    prompt += `\n【创作者图谱定制指令】：${userFeedback}\n`;
  }
  return prompt;
}
