/**
 * workflows/steps/extract-visual-spec.step.ts
 * 步骤：实物与场景纯文本提取 (Step 1 of Video Production)
 * 仅调用 LLM 提取角色、实物道具与场景的纯文本特征设定与提示词，不消耗算力出图
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { executeAssetExtractionStep } from '../../agents/film-production/01-asset-extraction/index.js';
import {
  GlobalEntitiesSchema,
  type GlobalEntities,
} from '../../project-store/contracts/film-production/lookdev.js';
import { createProgressReporter } from '../../workflow-engine/progress.js';
import {
  STAGE,
  FILM_STEP,
  writeArtifactFile,
  renderArtifactMarkdown,
} from '../../project-store/artifact-fs.js';

export const extractVisualSpecInputSchema = z.object({
  projectId: z.string(),
  taskId: z.string().optional(),
});

export const extractVisualSpecOutputSchema = z.object({
  projectId: z.string(),
  entities: GlobalEntitiesSchema,
});

export type ExtractVisualSpecInput = z.infer<typeof extractVisualSpecInputSchema>;
export type ExtractVisualSpecOutput = z.infer<typeof extractVisualSpecOutputSchema>;

/**
 * 步骤核心逻辑：纯文本实物与场景提取（不生成图片）
 */
export async function executeExtractVisualSpecStep(
  input: ExtractVisualSpecInput
): Promise<ExtractVisualSpecOutput> {
  const { projectId, taskId = 'task_extract_visual_spec' } = input;
  const store = ProjectStore.getInstance();
  const report = createProgressReporter(projectId, taskId);

  report(15, '视频 Agent Step 1：正在分析策划案与剧本大纲，提取全剧实物与场景...');

  const gdd = store.getArtifact<any>(projectId, 'gdd');
  const plannerPrd = store.getArtifact<any>(projectId, 'planner_prd');
  const prd = plannerPrd?.prd || gdd?.prd;
  const title = gdd?.title || prd?.gameTitle || store.getProject(projectId).meta.title;
  const storyMarkdown = gdd?.storyMarkdown || '';

  if (!prd) {
    throw new Error(`[ExtractVisualSpecStep] 项目 [${projectId}] 缺少策划案 PRD，无法提取视觉资产`);
  }

  report(45, '正在通过大模型进行角色定妆、实物道具、场景外观结构化语义提取（纯文本提取，不耗费生图算力）...');

  const { entities } = await executeAssetExtractionStep({
    projectId,
    title,
    prd,
    storyMarkdown,
  });

  report(85, `提取完成：${entities.characters.length} 个角色、${entities.items.length} 件道具、${entities.locations.length} 个场景，正在落盘...`);

  // 100% 写入单事实来源 ProjectStore (SSOT: lookdev_entities)
  store.setArtifact(projectId, 'lookdev_entities', entities);

  // 落盘 delivery 与 debug 镜像
  try {
    const md = renderArtifactMarkdown(`《${title}》实物与场景视听资产设定清单`, entities);
    writeArtifactFile(projectId, 'debug', STAGE.filmAdapter, FILM_STEP.extract, 'entities.md', md);
    writeArtifactFile(projectId, 'delivery', STAGE.filmAdapter, FILM_STEP.extract, 'entities.md', md);
  } catch (err) {
    console.warn(`[ExtractVisualSpecStep] 写入实体清单失败:`, err);
  }

  report(100, `实物与场景提取成功，视频工坊就绪`);

  return {
    projectId,
    entities,
  };
}

export const extractVisualSpecStep = createStep({
  id: 'extract-visual-spec',
  description: '提取影视视听角色、实物道具与场景纯文本设定',
  inputSchema: extractVisualSpecInputSchema,
  outputSchema: extractVisualSpecOutputSchema,
  execute: async ({ context }) => executeExtractVisualSpecStep(context),
});
