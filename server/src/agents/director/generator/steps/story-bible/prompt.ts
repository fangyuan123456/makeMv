/**
 * agents/pipeline/workflows/steps/story-bible/prompt.ts
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
  style: string = '电影质感，高品质影视光影',
  constraints?: string[],
  userFeedback?: string,
  dialogueHistory?: string
): string {
  let prompt = `【创作者核心构思】：${idea}\n【视觉影调风格】：${style}\n`;

  if (dialogueHistory && dialogueHistory.trim()) {
    prompt += `\n【AI总导演主线剧情构思与视听基调指导】：\n${dialogueHistory.trim()}\n\n【编剧生成准则】：请充分参考总导演梳理的故事核心主线大纲、主角动机与视听基调作为主干方向指引；具体的三幕展开与后续互动分支抉择由各子阶段专业推演生成。\n`;
  }

  if (constraints && constraints.length > 0) {
    prompt += `\n【创作者已明确的刚性要求与禁忌红线 (绝对遵从)】：\n${constraints.map((c) => `- ${c}`).join('\n')}\n`;
  }
  if (userFeedback) {
    prompt += `\n【创作者单步修改指示/反馈】：${userFeedback}\n请务必吸收并针对性调整。\n`;
  }
  return prompt;
}

export const STORY_GRAPH_AND_PIVOTS_SYSTEM_PROMPT = `你是一位精通互动影游（FMV / Interactive Drama）与非线性剧情拓扑编译的顶级总导演与首席关卡编剧。
你的任务是基于故事黄金三幕主干，一体化推演出全剧的【核心互动抉择点矩阵 (pivotPoints)】与【有向无环 (DAG) 网状互动剧情拓扑图 (storyGraph)】。

【设计原则与图论铁律】：
1. 抉择有实质戏剧代价：拒绝假选择，每个宏观抉择点（pivotPoints）必须包含至少 2 个互斥且动机强烈的两难选项；
2. 拓扑与抉择紧密互锁：拓扑图（storyGraph.nodes）中的关键分支节点（choices）必须真实承接这些宏观抉择，每个 choice.targetNodeId 必须严格指向存在的下游节点 ID；
3. 严格连通与终局收敛：除根节点 (rootNodeId) 外所有节点必须可达；全图至少包含一个终局节点（isEnding: true，无下游 choices）；
4. 节点数量：编译生成紧凑、节奏紧凑的高戏剧性交互节点（>= 3 个节点），并在每个节点的 characterNames 中明确标注登场出镜人物。`.trim();

export function buildStoryGraphAndPivotsPrompt(spine: StorySpineOutput, userFeedback?: string): string {
  let prompt = `【故事标题】：${spine.title}\n【故事大纲】：${spine.logline}\n【核心立意】：${spine.theme}\n【视觉基调】：${spine.style}\n\n【黄金三幕主干】：\n`;
  for (const act of spine.goldenSpine) {
    prompt += `第 ${act.act} 幕 [${act.name}]: ${act.summary} (悬念钩子: ${act.cliffhanger || '无'})\n`;
  }

  if (userFeedback) {
    prompt += `\n【创作者互动偏好与图谱定制指令】：${userFeedback}\n`;
  }

  prompt += `\n【编剧与关卡设计要求】：
请一体化输出全片的：
1. 核心互动抉择点矩阵 (pivotPoints)：至少 1 个宏观两难抉择点，每个抉择点包含 >= 2 个具有戏剧代价的选项；
2. 网状剧情拓扑 (storyGraph)：以 rootNodeId 开始，节点数量 >= 3，节点之间的 choices.targetNodeId 必须严格对应目标节点 ID，全片有明确终局 (isEnding: true)。`;

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
3. 节点数量：编译生成紧凑、戏剧性强的交互节点（至少 3 个节点）。`.trim();

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
1. 视觉具象化：外貌描写杜绝“英俊漂亮”等空泛词，必须精确到发型、眼神质感、伤疤或标志性衣着特征；
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
