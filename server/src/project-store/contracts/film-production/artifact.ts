import { z } from 'zod';
import { FilmAdapterArtifactSchema } from './film-spec.js';

export const FilmProductionInputSchema = z.object({
  projectId: z.string(),
  title: z.string(),
  prd: z.unknown(),
  storyMarkdown: z.string(),
});
export type FilmProductionInput = z.infer<typeof FilmProductionInputSchema>;

export const FilmProductionArtifactSchema = FilmAdapterArtifactSchema.extend({
  source: z.literal('film-production').default('film-production'),
});
export type FilmProductionArtifact = z.infer<typeof FilmProductionArtifactSchema>;
