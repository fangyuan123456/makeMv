/**
 * tools/planner/screenplay-tool/steps/02-screenplay/step.ts
 * 步骤二：全景剧本编写专属工序执行器 (screenplayStep)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { writeSceneText } from './write-node.js';
import {
  ScreenplayOutputSchema,
  ScreenplayStepInputSchema,
  FullScriptTextOutputSchema,
  NodeScriptOutputSchema,
  type ScreenplayOutput,
} from './schema.js';
import type { PremiseOutput } from '../01-premise/schema.js';
import { renderScreenplay } from './render.js';
import { expandStoryPaths } from './expand-paths.js';
import {
  buildScreenplaySystemPrompt,
  buildNodeScriptPrompt,
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
    if (!premise?.title || !Array.isArray(premise?.characters) || premise.characters.length === 0) {
      throw new Error('[screenplayStep] 契约执行阻断：前序步骤 premise 未生成合法的角色与标题设定');
    }
    const originalInput = ctx.triggerData || ctx;
    const userPrompt = originalInput?.userPrompt || premise.sourcePrompt || premise.logline || '';
    const abortSignal = originalInput?.abortSignal || originalInput?._context?.abortSignal || ctx.abortSignal;

    const parsed = await expandStoryPaths(premise, (node, history) => writeSceneText({
      prompt: buildNodeScriptPrompt({ premise, userPrompt, node, history }),
      abortSignal,
    }));

    const finalOutput: ScreenplayOutput = {
      title: premise.title,
      genre: premise.genre,
      logline: premise.logline,
      characters: premise.characters,
      scriptMarkdown: renderScreenplay(premise, FullScriptTextOutputSchema.parse(parsed)),
    };

    return finalOutput;
  },
});
