/**
 * tools/planner/screenplay-tool/steps/02-screenplay/step.ts
 * 步骤二：全景剧本编写专属工序执行器 (screenplayStep)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import {
  ScreenplayOutputSchema,
  ScreenplayStepInputSchema,
  FullScriptTextOutputSchema,
  type ScreenplayOutput,
  type FullScriptTextOutput,
} from './schema.js';
import type { PremiseOutput } from '../01-premise/schema.js';
import {
  buildScreenplaySystemPrompt,
  buildFullScriptPrompt,
} from './prompt.js';

export const screenplayStep = createStep({
  id: 'generate-full-screenplay',
  description: '编写包含视听场景、对白、互动抉择点与完整分支结局的 Markdown 互动影游剧本',
  inputSchema: ScreenplayStepInputSchema,
  outputSchema: ScreenplayOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const stepOutput =
      ctx.getStepResult?.('premise-and-characters') ||
      ctx.steps?.['premise-and-characters']?.output ||
      ctx.triggerData?.['premise-and-characters'] ||
      ctx;
    const premise: PremiseOutput = (stepOutput?.characters ? stepOutput : ctx.characters ? ctx : ctx.triggerData) || {};
    const originalInput = ctx.triggerData || ctx;
    const userPrompt = originalInput?.userPrompt || premise.logline || '';

    const agent = new Agent({
      name: 'screenplay-writer-agent',
      instructions: buildScreenplaySystemPrompt(),
      model: LLMProvider.getModel(),
    });

    const prompt = buildFullScriptPrompt({
      premise,
      userPrompt,
    });

    const parsed = (await generateStructured({
      agent,
      prompt,
      schema: FullScriptTextOutputSchema,
      stage: 'planner-tool',
      step: 'screenplay-markdown',
      label: '互动全景剧本生成',
    })) as FullScriptTextOutput;

    const finalOutput: ScreenplayOutput = {
      title: premise.title,
      genre: premise.genre,
      logline: premise.logline,
      characters: premise.characters,
      scriptMarkdown: parsed.scriptMarkdown,
    };

    return finalOutput;
  },
});
