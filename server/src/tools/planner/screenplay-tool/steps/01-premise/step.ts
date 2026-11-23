/**
 * tools/planner/screenplay-tool/steps/01-premise/step.ts
 * 步骤一：设定与故事大纲专属工序执行器 (premiseStep)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import { validateStoryGraph } from '../../../validate-story-graph.js';
import { planCausalStory } from './causal-planner.js';
import {
  PremiseStepInputSchema,
  PremiseOutputSchema,
  type PremiseStepInput,
} from './schema.js';
import {
  buildPremiseSystemPrompt,
  buildPremisePrompt,
} from './prompt.js';

export const premiseStep = createStep({
  id: 'premise-and-characters',
  description: '推演互动影游的世界观设定、核心角色与分幕故事大纲',
  inputSchema: PremiseStepInputSchema,
  outputSchema: PremiseOutputSchema,
  execute: async ({ context }) => {
    // 刚性唯一消费 Mastra 工作流契约 triggerData，杜绝入参丢失
    const input = ((context as any)?.triggerData || context) as PremiseStepInput;

    if (!input?.userPrompt || typeof input.userPrompt !== 'string' || input.userPrompt.trim().length === 0) {
      throw new Error('[premiseStep] 契约执行阻断：缺少必填的创作者创意构想 (userPrompt 不能为空)');
    }

    const abortSignal = (input as any).abortSignal || input._context?.abortSignal || (context as any)?.abortSignal;

    const agent = new Agent({
      name: 'screenplay-premise-agent',
      instructions: buildPremiseSystemPrompt(),
      model: LLMProvider.getModel({ enableThinking: true }),
    });

    const prompt = buildPremisePrompt({
      userPrompt: input.userPrompt.trim(),
      genre: input.genre?.trim(),
      tone: input.tone?.trim(),
      expectedActs: input.expectedActs || 3,
    });

    const premise = await planCausalStory(
      (schema, request, label) => generateStructured({retryEmptyResponse:true,agent,prompt:request,schema,stage:'planner-tool',step:'causal-premise',label,abortSignal}),
      prompt,input.userPrompt.trim(),input.expectedActs || 3,
    );
    for (const node of premise.storyNodes) {
      if (node.choices.length && node.nextNodeId) {
        throw new Error(`大纲节点 ${node.id} 同时包含选项与自动后继`);
      }
      if (!premise.actOutlines.some(act => act.actNumber === node.actNumber)) {
        throw new Error(`大纲节点 ${node.id} 引用了不存在的幕次`);
      }
    }
    validateStoryGraph(premise.startNodeId, premise.storyNodes.map(node => ({
      id: node.id,
      terminal: node.kind === 'ending',
      targets: node.choices.length ? node.choices.flatMap(c => c.nextRoutes?.map(r=>r.targetNodeId) || [c.targetNodeId]) : node.nextRoutes?.map(r=>r.targetNodeId) || (node.nextNodeId ? [node.nextNodeId] : []),
    })));
    return premise;
  },
});
