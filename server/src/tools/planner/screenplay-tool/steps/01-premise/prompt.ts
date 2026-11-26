/**
 * tools/planner/screenplay-tool/steps/01-premise/prompt.ts
 * 步骤一：设定与故事大纲专属提示词体系 (Premise Step Prompt SSOT)
 */

import type { ScreenplayInput } from './schema.js';
import { getSkillPrompt } from '../../../../../skills/index.js';

export function buildPremiseSystemPrompt(): string {
  return `你是一名享誉国际的顶级互动影视总编剧与世界观架构师。
你的唯一核心职责是：严格根据创作者提供的核心构思与剧情需求，推演出深度契合该题材的世界观基调、极具戏剧张力与心理动机的核心登场角色、**紧凑明快、戏剧因果链条严密的精炼分幕大纲**，以及全剧最多 2 个互动分支抉择点。

【工程契约与大纲约束】
1. **忠实题材**：100% 忠实于创作者输入的题材与设定，角色身份、外貌符号与戏剧动机完全服务于核心冲突。
2. **分幕大纲规范**：
   - 每幕 \`plotSummary\` 约 80-150 字，清晰交代起因、危机、交锋与转折，拒绝注水空话；
   - 每幕 \`scenes\` 聚焦 1 个核心母场景（全剧母场景总量 2~3 个）；
   - 每幕标出 \`turningPoint\`（转折点）与 \`suspense\`（互动悬念）。
3. **分支 Schema 绑定（\`branchPoints\` 数组长度 ≤ 2）**：
   - 过程节点：错误/逃避选项直接走向专有终局（\`targetType: 'ENDING'\`），承担代价选项推进主线（\`targetType: 'CONTINUE_MAINLINE'\`）；
   - 高潮节点：各选项分别通往独立结局（\`targetType: 'ENDING'\`）；
   - 每个走向 \`ENDING\` 的选项，必须在 \`endingTitle\` 与 \`endingType\` 明确定义结局名称与类型，并在 \`approachAndCost\` 交代命运终局。

${getSkillPrompt('ai-interactive-screenplay')}

严格按照 PremiseOutputSchema 契约输出结构化大纲、角色人设与最多 2 个核心分支抉择点。`;
}

export function buildPremisePrompt(input: ScreenplayInput): string {
  const { userPrompt, genre, tone, expectedActs = 3 } = input;
  return `请严格以以下创作者需求为最高戏剧纲领，推演故事的世界观基调、核心角色设定、${expectedActs} 幕紧凑精炼的主线大纲，以及全剧最多 2 个互动分支抉择点：

【创作者需求（核心最高纲领）】：
${userPrompt}

${genre ? `【题材偏好】：${genre}\n` : ''}${tone ? `【视听基调】：${tone}\n` : ''}【期望分幕数量】：${expectedActs} 幕

【特别编写要求】：
- 故事标题、核心主角身份与对立力量必须直接源自上述【创作者需求】；
- 完整输出 ${expectedActs} 幕大纲（actNumber 从 1 到 ${expectedActs}），严格遵循上述技能规范与 PremiseOutputSchema 契约输出结构化数据。`;
}
