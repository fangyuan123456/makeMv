import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import type { GlobalEntities } from '../../../../project-store/contracts/film-production/lookdev.js';
import type { UniversalPrdSpec } from '../../../../project-store/contracts/planner/index.js';
import { generateStoryboard } from './agent.js';
import { FilmAdapterArtifactSchema, type FilmAdapterArtifact } from './schema.js';

export const storyboardStepInputSchema = z.object({
  projectId: z.string(),
  title: z.string().optional(),
  prd: z.custom<UniversalPrdSpec>().optional(),
  storyMarkdown: z.string().optional(),
  entities: z.custom<GlobalEntities>().optional(),
});

export const storyboardStepOutputSchema = FilmAdapterArtifactSchema;

export async function executeStoryboardStep(input: {
  projectId: string;
  title?: string;
  prd?: UniversalPrdSpec;
  storyMarkdown?: string;
  entities?: GlobalEntities;
}): Promise<FilmAdapterArtifact> {
  const store = ProjectStore.getInstance();
  const gdd = store.getArtifact<any>(input.projectId, 'gdd');
  const prd = input.prd || store.getArtifact<any>(input.projectId, 'planner_prd')?.prd || gdd?.prd;
  const title = input.title || gdd?.title || prd?.gameTitle || '未命名短剧';
  const storyMarkdown = input.storyMarkdown || gdd?.storyMarkdown || '';
  if (!prd) throw new Error(`[StoryboardStep] 项目 [${input.projectId}] 缺少 planner_prd`);
  const entities = input.entities || store.getArtifact<any>(input.projectId, 'lookdev_draft')?.entities;
  const result = await generateStoryboard({ title, prd, storyMarkdown, entities });
  const withContext = input.projectId ? { ...result, projectId: input.projectId } : result;
  if (input.projectId) ProjectStore.getInstance().setArtifact(input.projectId, 'film_spec', withContext);
  return withContext;
}

export const storyboardStep = createStep({
  id: 'film-storyboard',
  description: '将每个文游伪视频分解为可生成的镜头订单',
  inputSchema: storyboardStepInputSchema,
  outputSchema: storyboardStepOutputSchema,
  execute: async ({ context }) => executeStoryboardStep(context),
});

