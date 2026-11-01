/**
 * skills/story-bible/prompt.ts
 * 故事世界观圣经推演专属纯中文提示词体系 (Story Bible Prompt SSOT)
 */

import type { StorySpineOutput, PivotPointsOutput, StoryGraphOutput } from './schema.js';

export const STORY_SPINE_SYSTEM_PROMPT = `你是一位顶级影视互动导演、商业编剧与世界观叙事架构师。
你的职责是根据用户的核心灵感与视觉基调，构思出一部具有极高商业化互动潜质、戏剧张力饱满且冲突尖锐的互动影游大纲。

【专业导演原则】：
1. 冲突极致：主角必须在不可调和的两难困境或高压危机中推进；
2. 互动友好：剧情骨架天然蕴含多重走向潜质，非扁平线性流水账；
3. 严格遵循纯中文影视术语，杜绝空洞口号。`.trim();

export function buildStorySpinePrompt(
  idea: string,
  style: string = '电影质感，高对比度光影',
  constraints?: string[],
  userFeedback?: string
): string {
  let prompt = `【创作者核心构思】：${idea}\n【视觉影调风格】：${style}\n`;
  if (constraints && constraints.length > 0) {
    prompt += `\n【创作者已明确的刚性要求与禁忌红线 (绝对遵从)】：\n${constraints.map((c) => `- ${c}`).join('\n')}\n`;
  }
  if (userFeedback) {
    prompt += `\n【创作者单步修改指示/反馈】：${userFeedback}\n请务必吸收并针对性调整。\n`;
  }
  return prompt;
}

export const PIVOT_POINTS_SYSTEM_PROMPT = `你是一位精通互动影游（FMV / Interactive Drama）与非线性游戏关卡设计的互动导演。
你的职责是基于故事主干大纲，精准推演出最具震撼力、两难道德困境与重大分支走向的【核心互动抉择点矩阵】。

【设计原则】：
1. 拒绝假选择：每个宏观选项必须有截然不同的戏剧因果与代价（非简单文本差量）；
2. 动机成立：两难抉择必须植根于角色的核心欲望、秘密或保命需求。`.trim();

export function buildPivotPointsPrompt(spine: StorySpineOutput, userFeedback?: string): string {
  let prompt = `【故事标题】：${spine.title}\n【故事大纲】：${spine.logline}\n【核心立意】：${spine.theme}\n\n【幕次结构】：\n`;
  for (const act of spine.goldenSpine) {
    prompt += `第 ${act.act} 幕 [${act.name}]: ${act.summary} (悬念: ${act.cliffhanger || '无'})\n`;
  }
  if (userFeedback) {
    prompt += `\n【创作者交互偏好修改指示】：${userFeedback}\n`;
  }
  return prompt;
}

export const STORY_GRAPH_SYSTEM_PROMPT = `你是一位精通非线性互动叙事、游戏关卡图谱与互动影视分支树拓扑编译的总编剧。
你的任务是将线性大纲与关键抉择点，编译重构为一张【有向无环 (DAG) 网状互动剧情拓扑图】。

【图论与叙事硬性铁律】：
1. 连通性：除根节点 (rootNodeId) 外，每个节点必须可达；
2. 终局收束：所有分支路径最终必须收敛汇聚至结局节点（isEnding: true，无下游 choices）；
3. 节点数量：编译生成 6~10 个结构紧凑、戏剧性强的交互节点。`.trim();

export function buildStoryGraphPrompt(
  spine: StorySpineOutput,
  pivots: PivotPointsOutput,
  userFeedback?: string
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

export const CHARACTER_PROFILES_SYSTEM_PROMPT = `你是一位顶级影视选角导演、角色概念设计师与戏剧人物心理学专家。
你的职责是根据故事大纲与全剧互动图谱，深入推演出极具辨识度、动机扎实且视觉特征强烈的【核心角色名录与小传档案】。

【创作原则】：
1. 视觉具象化：外貌描写杜绝“英俊漂亮”等空泛词，必须精确到发型、眼神质感、伤疤或标志性衣着颜色；
2. 戏剧对立：主要角色之间的欲望动机必须形成张力与互锁。`.trim();

export function buildCharacterProfilesPrompt(
  spine: StorySpineOutput,
  graph: StoryGraphOutput,
  userFeedback?: string
): string {
  const allNames = Array.from(
    new Set(graph.nodes.flatMap((n) => n.characterNames).filter(Boolean))
  );

  let prompt = `【故事标题】：${spine.title}\n【故事大纲】：${spine.logline}\n【视觉基调】：${spine.style}\n\n`;
  prompt += `【剧情出镜角色名单】：${allNames.join('、') || '请根据剧情大纲推演核心主角与核心对立面'}\n`;

  if (userFeedback) {
    prompt += `\n【创作者角色设计修改指令】：${userFeedback}\n`;
  }
  return prompt;
}
