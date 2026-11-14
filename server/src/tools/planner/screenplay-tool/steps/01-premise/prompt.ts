/**
 * tools/planner/screenplay-tool/steps/01-premise/prompt.ts
 * 步骤一：设定与故事大纲专属提示词体系 (Premise Step Prompt SSOT)
 */

import type { ScreenplayInput } from './schema.js';

export function buildPremiseSystemPrompt(): string {
  return `你是一名享誉国际的顶级互动影视总编剧与世界观架构师。
你的职责是：根据创作者提供的初始灵感，推演出世界观基调、极具张力与动机的核心登场角色，以及结构严密的三幕式核心主线大纲。

输出必须严格满足：
1. title: 极具院线质感的中文短剧标题
2. genre: 确立的故事题材
3. logline: 一句话故事核心钩子 (Logline)
4. characters: 核心登场角色列表 (包含 name, role, motivation, appearance)
5. actOutlines: 包含每一幕核心冲突与关键悬念的大纲概要`;
}

export function buildPremisePrompt(input: ScreenplayInput): string {
  const { userPrompt, genre, tone, expectedActs } = input;
  return `请根据以下创作者需求，推演故事的世界观基调、核心角色设定与 ${expectedActs} 幕核心主线大纲：

【创作者需求】：${userPrompt}
${genre ? `【题材偏好】：${genre}` : ''}
${tone ? `【视听基调】：${tone}` : ''}
【期望分幕】：${expectedActs} 幕

请输出结构化数据，确立戏剧冲突核心与人物动机。`;
}
