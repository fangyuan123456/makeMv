/**
 * tools/planner/screenplay-tool/steps/01-premise/step.ts
 * 步骤一：设定与故事大纲专属工序执行器 (premiseStep)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import {
  PremiseStepInputSchema,
  PremiseOutputSchema,
  type PremiseOutput,
} from './schema.js';
import {
  buildPremiseSystemPrompt,
  buildPremisePrompt,
} from './prompt.js';

export const premiseStep = createStep({
  id: 'premise-and-characters',
  description: '推演互动影游的世界观设定、核心角色与三幕式故事大纲',
  inputSchema: PremiseStepInputSchema,
  outputSchema: PremiseOutputSchema,
  execute: async ({ context }) => {
    const input = (context as any) || {};
    const agent = new Agent({
      name: 'screenplay-premise-agent',
      instructions: buildPremiseSystemPrompt(),
      model: LLMProvider.getModel(),
    });

    const prompt = buildPremisePrompt({
      userPrompt: input.userPrompt,
      genre: input.genre,
      tone: input.tone,
      expectedActs: input.expectedActs || 3,
    });

    const result = await generateStructured({
      agent,
      prompt,
      schema: PremiseOutputSchema,
      stage: 'planner-tool',
      step: 'premise',
      label: '剧本设定与大纲推演',
    });

    return result as PremiseOutput;
  },
});
