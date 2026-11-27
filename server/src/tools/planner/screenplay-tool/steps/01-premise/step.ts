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
  type PremiseStepInput,
  type PremiseOutput,
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
      model: LLMProvider.getModel(),
    });

    const prompt = buildPremisePrompt({
      userPrompt: input.userPrompt.trim(),
      genre: input.genre?.trim(),
      tone: input.tone?.trim(),
      expectedActs: input.expectedActs || 3,
    });

    const result = await generateStructured({
      agent,
      prompt,
      schema: PremiseOutputSchema,
      stage: 'planner-tool',
      step: 'premise',
      label: '剧本设定与大纲推演',
      abortSignal,
    });

    const premise = result as PremiseOutput;
    const maxActNumber = (premise.actOutlines || []).reduce(
      (max, act) => Math.max(max, act.actNumber || 0),
      0
    );
    if (maxActNumber > 0 && Array.isArray(premise.interactions)) {
      for (const inter of premise.interactions) {
        if (inter.actNumber >= maxActNumber) {
          for (const outcome of inter.outcomes || []) {
            if (outcome.targetType === 'CONTINUE_MAINLINE') {
              const upperKey = String(outcome.key || '').toUpperCase();
              outcome.targetType = 'ENDING';
              outcome.endingType = outcome.endingType || (upperKey === 'FAIL' || upperKey === 'TIMEOUT' ? 'BE' : 'HE');
              outcome.endingTitle = outcome.endingTitle || outcome.label || '终局结算';
            }
          }
        }
      }
    }

    return premise;
  },
});
