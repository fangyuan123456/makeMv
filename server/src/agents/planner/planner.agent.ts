/**
 * agents/planner/planner.agent.ts
 * 策划 Agent (Planner Agent SSOT) - 基于 Mastra 官方微内核 Agent 原生实现
 *
 * 核心定位：
 * 纯粹的 Mastra 官方 Agent 认知模型定义，提供系统提示词与通用大模型绑定。
 * 业务工序调度由 workflows/steps/plan-gdd.step.ts 内聚驱动，杜绝 Agent 层散落 loose 执行函数。
 */

import { Agent } from '@mastra/core/agent';
import type { LanguageModelV1 } from 'ai';
import { LLMProvider } from '../../llm/index.js';
import { buildPlannerSystemPrompt } from './prompt.js';
import { runPlannerWorkflow } from './planner.workflow.js';
import type { GDDArtifact } from './schema.js';

export interface PlannerAgentOptions {
  model?: LanguageModelV1;
}

/**
 * 创建策划 Agent 实例
 */
export function createPlannerAgent(options: PlannerAgentOptions = {}): Agent {
  return new Agent({
    name: 'planner-agent',
    instructions: buildPlannerSystemPrompt(),
    model: options.model || LLMProvider.getModel(),
  });
}

export const plannerAgent = createPlannerAgent();

/**
 * 策划推演合法门面：桥接至 Mastra 微内核 plannerWorkflow (5大工序流水线)
 */
export async function planGDDWithAgent(
  input: { userPrompt: string; projectId: string },
  _agent?: Agent
): Promise<GDDArtifact> {
  const result = await runPlannerWorkflow({
    projectId: input.projectId,
    userPrompt: input.userPrompt,
  });
  return result.gdd;
}
