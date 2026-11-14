/**
 * agents/film-production/02-storyboard-planning/schema.ts
 * 分镜台本规划强类型契约 (Step 2 of Film Production SSOT)
 *
 * 核心职责：
 * 纯文字大模型视听拆解，将剧本正文与策划案 PRD 依据已提取的实物与场景设定，
 * 拆解为全量各幕分镜镜头切片清单 (FilmAdapterArtifact)，零物理媒体出图算力。
 */

import { z } from 'zod';
import {
  FilmAdapterArtifactSchema,
  CinematicClipOrderSchema,
  CinematicShotOrderSchema,
  type FilmAdapterArtifact,
  type CinematicClipOrder,
  type CinematicShotOrder,
} from '../../../project-store/contracts/film-production/film-spec.js';
import type { UniversalPrdSpec } from '../../../project-store/contracts/planner/index.js';
import type { GlobalEntities } from '../../../project-store/contracts/film-production/lookdev.js';

export const StoryboardPlanningInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().optional().describe('作品标题'),
  prd: z.custom<UniversalPrdSpec>().optional().describe('策划案 PRD 规范'),
  storyMarkdown: z.string().optional().describe('剧本正文 Markdown'),
  entities: z.custom<GlobalEntities>().optional().describe('上游已提取的实物与场景设定'),
});

export const StoryboardPlanningOutputSchema = FilmAdapterArtifactSchema;

export type StoryboardPlanningInput = z.infer<typeof StoryboardPlanningInputSchema>;
export type StoryboardPlanningOutput = z.infer<typeof StoryboardPlanningOutputSchema>;

export {
  FilmAdapterArtifactSchema,
  CinematicClipOrderSchema,
  CinematicShotOrderSchema,
  type FilmAdapterArtifact,
  type CinematicClipOrder,
  type CinematicShotOrder,
};
