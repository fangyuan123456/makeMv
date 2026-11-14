/**
 * agents/film-production/01-asset-extraction/step.ts
 * 视觉资产提取原子 Step (零算力生图，纯 LLM 结构化提取)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../llm/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../utils/llm-diagnostics.js';
import { STAGE, FILM_STEP, writeArtifactFile, renderArtifactMarkdown } from '../../../project-store/artifact-fs.js';
import {
  AssetExtractionInputSchema,
  AssetExtractionOutputSchema,
  type AssetExtractionInput,
  type AssetExtractionOutput,
  GlobalEntitiesSchema,
  type GlobalEntities,
} from './schema.js';
import {
  buildAssetExtractionSystemPrompt,
  buildAssetExtractionUserPrompt,
} from './prompt.js';

export function createConceptArtDirectorAgent(): Agent {
  return new Agent({
    name: 'concept-art-director-agent',
    instructions: buildAssetExtractionSystemPrompt(),
    model: LLMProvider.getModel(),
  });
}

/**
 * 纯大模型结构化视觉资产提取执行器
 */
export async function executeAssetExtractionStep(
  input: AssetExtractionInput,
  agent: Agent = createConceptArtDirectorAgent()
): Promise<AssetExtractionOutput> {
  const prompt = buildAssetExtractionUserPrompt(input);
  const object = await generateStructured({
    agent,
    prompt,
    schema: GlobalEntitiesSchema,
    stage: STAGE.filmAdapter,
    step: FILM_STEP.extract,
    label: '视觉资产纯文本提取',
  });

  if (!object) {
    throw new Error(`[AssetExtractionStep] 项目 [${input.projectId}] 视觉资产结构化提取失败，未获得合规实体设定`);
  }

  const entities = object;

  // 100% 写入单一事实来源 ProjectStore (SSOT: lookdev_entities)
  const store = ProjectStore.getInstance();
  store.setArtifact(input.projectId, 'lookdev_entities', entities);

  // 落盘展示镜像
  try {
    const md = renderArtifactMarkdown(`《${input.title}》全剧视听资产设定清单`, entities);
    writeArtifactFile(input.projectId, 'debug', STAGE.filmAdapter, FILM_STEP.extract, 'entities.md', md);
    writeArtifactFile(input.projectId, 'delivery', STAGE.filmAdapter, FILM_STEP.extract, 'entities.md', md);
  } catch (err) {
    console.warn(`[AssetExtractionStep] 写入实体清单失败:`, err);
  }

  return { entities };
}

export const assetExtractionStep = createStep({
  id: 'step_asset_extraction',
  description: '提取影视视听角色、实物道具与场景纯文本设定（零算力生图）',
  inputSchema: AssetExtractionInputSchema,
  outputSchema: AssetExtractionOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx;
    return await executeAssetExtractionStep(input);
  },
});
