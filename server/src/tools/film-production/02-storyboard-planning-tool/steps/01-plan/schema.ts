/**
 * tools/film-production/02-storyboard-planning-tool/steps/01-plan/schema.ts
 * 分镜台本规划工序专属契约 (Storyboard Planning Step Contract)
 */

import { z } from 'zod';
import {
  FilmAdapterArtifactSchema,
  type FilmAdapterArtifact,
} from '../../../../../project-store/contracts/film-production/film-spec.js';
import {
  GlobalEntitiesSchema,
  type GlobalEntities,
} from '../../../../../project-store/contracts/film-production/lookdev.js';

export const StoryboardPlanningInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().optional().describe('故事标题'),
  prd: z.any().describe('策划案 PRD (UniversalPrdSpec)'),
  storyMarkdown: z.string().optional().describe('故事剧本正文 Markdown'),
  entities: GlobalEntitiesSchema.optional().describe('前序提取出的视觉资产表 (包含角色、道具、场景外观)'),
});

export type StoryboardPlanningInput = z.infer<typeof StoryboardPlanningInputSchema>;

export const StoryboardPlanningOutputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  filmSpec: FilmAdapterArtifactSchema.describe('全剧各幕分镜台本与镜头制作订单 (FilmAdapterArtifact)'),
});

export type StoryboardPlanningOutput = z.infer<typeof StoryboardPlanningOutputSchema>;

export const StoryboardPlanningStepInputSchema = StoryboardPlanningInputSchema.extend({
  _context: z.any().optional(),
});

export type StoryboardPlanningStepInput = z.infer<typeof StoryboardPlanningStepInputSchema>;
