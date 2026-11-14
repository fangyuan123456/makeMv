/**
 * tools/planner/script-to-prd-tool/steps/01-extract/step.ts
 * 步骤一：剧本结构语义抽取专属工序执行器 (extractScriptStep)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import {
  ExtractStepInputSchema,
  ExtractedScriptStructureSchema,
  type ExtractedScriptStructure,
} from './schema.js';
import {
  buildScriptToPrdSystemPrompt,
  buildScriptToPrdUserPrompt,
} from './prompt.js';

export const extractScriptStep = createStep({
  id: 'extract-script-structure',
  description: '从完整 Markdown 剧本中提取分幕切片、互动抉择点与结局结构',
  inputSchema: ExtractStepInputSchema,
  outputSchema: ExtractedScriptStructureSchema,
  execute: async ({ context }) => {
    const input = (context as any) || {};

    const agent = new Agent({
      name: 'script-parser-agent',
      instructions: buildScriptToPrdSystemPrompt(),
      model: LLMProvider.getModel(),
    });

    const prompt = buildScriptToPrdUserPrompt(
      input.scriptMarkdown || '',
      input.title
    );

    const extracted = (await generateStructured({
      agent,
      prompt,
      schema: ExtractedScriptStructureSchema,
      stage: 'planner-tool',
      step: 'script-extract',
      label: '剧本资产语义解析与结构抽取',
    })) as ExtractedScriptStructure;

    return extracted;
  },
});
