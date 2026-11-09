/**
 * agents/planner/planner.agent.ts
 * 策划 Agent (Planner Agent) - 基于 Mastra 官方微内核 Agent 原生实现
 *
 * 核心定位：
 * 作为首道工序智能体，接收创作者剧本创意意图，结合世界观规则推演输出强类型 GDD (Game Design Document)。
 */

import { Agent } from '@mastra/core/agent';
import type { LanguageModelV1 } from 'ai';
import { LLMProvider } from '../../llm/index.js';
import { GDDSchema, type GDDArtifact } from './schema.js';
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserPrompt } from './prompt.js';

export function createPlannerAgent(model?: LanguageModelV1): Agent {
  return new Agent({
    name: 'planner-agent',
    instructions: PLANNER_SYSTEM_PROMPT,
    model: model || LLMProvider.getModel(),
  });
}

export const plannerAgent = createPlannerAgent();

/**
 * 策划智能体核心推演函数：基于 Mastra Agent 原生结构化输出
 */
export async function planGDDWithAgent(
  userPrompt: string,
  agent: Agent = plannerAgent,
): Promise<GDDArtifact> {
  const prompt = buildPlannerUserPrompt(userPrompt);
  const result = await agent.generate(prompt, {
    output: GDDSchema,
  });

  return result.object as GDDArtifact;
}
