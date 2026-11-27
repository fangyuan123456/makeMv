/**
 * tools/film-production/asset-manifest-tool/steps/01-manifest/step.ts
 * 全剧资产清单发现执行工序 (Asset Manifest Step)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { resolveProjectStorySource } from '../../../../../project-store/story-source.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import {
  AssetManifestInputSchema,
  AssetManifestOutputSchema,
  type AssetManifestInput,
  type AssetManifestOutput,
} from './schema.js';
import { buildAssetManifestPrompt } from './prompt.js';

export const assetManifestStep = createStep({
  id: 'asset-manifest-step',
  description: '轻量秒级从剧本中提取全剧出场角色、场景与核心道具骨架清单',
  inputSchema: AssetManifestInputSchema,
  outputSchema: AssetManifestOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as AssetManifestInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const storySource = input.prd || resolveProjectStorySource(input.projectId);
    const storyMarkdown = input.storyMarkdown || storySource?.scriptMarkdown || '';

    const project = store.getProject(input.projectId);
    const title = project?.meta?.title || '影视互动剧';

    const agent = new Agent({
      name: 'asset-manifest-extractor',
      instructions: '你是资深电影制片统筹与选角总监。负责从剧本中按母场景聚类和触碰公理快速锁定全剧高信噪比核心资产清单。',
      model: LLMProvider.getModel(),
    });

    const prompt = buildAssetManifestPrompt({
      title,
      storyMarkdown,
      prd: storySource,
    });

    const manifestData = (await generateStructured({
      agent,
      prompt,
      schema: AssetManifestOutputSchema.omit({ projectId: true }),
      stage: 'film-tool',
      step: 'asset-manifest-extract',
      label: '提取全剧资产清单',
      abortSignal,
    })) as any;

    return {
      projectId: input.projectId,
      artStyle: manifestData.artStyle || '电影实拍质感与光影分级',
      characters: manifestData.characters || [],
      locations: manifestData.locations || [],
      items: manifestData.items || [],
    };
  },
});
