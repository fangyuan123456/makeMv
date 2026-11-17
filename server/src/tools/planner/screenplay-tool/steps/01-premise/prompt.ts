/**
 * tools/planner/screenplay-tool/steps/01-premise/prompt.ts
 * 步骤一：设定与故事大纲专属提示词体系 (Premise Step Prompt SSOT)
 */

import type { ScreenplayInput } from './schema.js';

export function buildPremiseSystemPrompt(): string {
  return `你是一名享誉国际的顶级互动影视总编剧与世界观架构师。
你的唯一核心职责是：严格根据创作者提供的核心构思与剧情需求，推演出深度契合该题材的世界观基调、极具戏剧张力与心理动机的核心登场角色，以及结构严密的分幕主线大纲。

【推演红线准则】
1. 严禁题材脱轨：必须 100% 忠实于创作者输入的题材与设定（如科幻生存、空间站引力异常、抉择机制等），严禁脱离创作者诉求自作主张改写为不相干的题材（如严禁将科幻改写为警匪追凶）！
2. 角色与冲突精准锚定：角色的身份、外貌符号与戏剧动机必须完全服务于创作者设定的核心情境与冲突。
3. 严格遵循分幕规划：按创作者指定的期望幕数输出结构化大纲，每一幕均需包含清晰的核心冲突与互动悬念。

输出必须严格满足：
1. title: 极具院线质感的中文短剧标题
2. genre: 确立的故事题材 (须与创作者偏好完全一致)
3. logline: 一句话故事核心钩子 (Logline)
4. characters: 核心登场角色列表 (包含 name, role, motivation, appearance)
5. actOutlines: 包含每一幕核心冲突与关键悬念的大纲概要`;
}

export function buildPremisePrompt(input: ScreenplayInput): string {
  const { userPrompt, genre, tone, expectedActs = 3 } = input;
  return `请严格以以下创作者需求为最高戏剧纲领，推演故事的世界观基调、核心角色设定与 ${expectedActs} 幕主线大纲：

【创作者需求（核心最高纲领）】：
${userPrompt}

${genre ? `【题材偏好】：${genre}\n` : ''}${tone ? `【视听基调】：${tone}\n` : ''}【期望分幕数量】：${expectedActs} 幕

【特别编写要求】：
- 故事标题、核心主角身份与对立力量必须直接源自上述【创作者需求】；
- 必须完整输出 ${expectedActs} 幕大纲（actNumber 从 1 到 ${expectedActs}），每一幕详细阐述冲突焦点与互动抉择动机；
- 请输出纯净符合契约的结构化数据。`;
}
