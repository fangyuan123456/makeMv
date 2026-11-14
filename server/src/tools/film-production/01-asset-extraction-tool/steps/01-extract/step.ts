/**
 * tools/film-production/01-asset-extraction-tool/steps/01-extract/step.ts
 * 视觉资产提炼工序执行器 (assetExtractionStep)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { GlobalEntitiesSchema, type GlobalEntities } from '../../../../../project-store/contracts/film-production/lookdev.js';
import {
  AssetExtractionStepInputSchema,
  AssetExtractionOutputSchema,
  type AssetExtractionStepInput,
  type AssetExtractionOutput,
} from './schema.js';
import {
  buildAssetExtractionSystemPrompt,
  buildAssetExtractionUserPrompt,
} from './prompt.js';

export const assetExtractionStep = createStep({
  id: 'extract-visual-entities',
  description: '从剧本与 PRD 中提炼角色、实物道具与场景外观设定及生图提示词 (纯文本提取)',
  inputSchema: AssetExtractionStepInputSchema,
  outputSchema: AssetExtractionOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as AssetExtractionStepInput;

    const store = ProjectStore.getInstance();
    const effectivePrd = input.prd || store.getArtifact(input.projectId, 'universal_prd');
    if (!effectivePrd && !input.storyMarkdown) {
      throw new Error(`[AssetExtractionTool] 项目 [${input.projectId}] 缺少前序策划案 PRD 或故事正文，无法提取视觉资产`);
    }

    const effectiveInput = {
      ...input,
      prd: effectivePrd,
    };

    const agent = new Agent({
      name: 'visual-asset-extractor-agent',
      instructions: buildAssetExtractionSystemPrompt(),
      model: LLMProvider.getModel(),
    });

    const prompt = buildAssetExtractionUserPrompt(effectiveInput);

    const entities = (await generateStructured({
      agent,
      prompt,
      schema: GlobalEntitiesSchema,
      stage: 'film-tool',
      step: 'asset-extract',
      label: '视觉资产纯文本提取',
    })) as GlobalEntities;

    if (input.projectId && entities) {
      store.setArtifact(input.projectId, 'lookdev_entities', entities);
    }

    const output: AssetExtractionOutput = {
      projectId: input.projectId,
      entities,
    };

    return output;
  },
});
