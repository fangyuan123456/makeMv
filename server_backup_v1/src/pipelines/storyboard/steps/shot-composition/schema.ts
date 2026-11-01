/**
 * pipelines/storyboard/steps/shot-composition/schema.ts
 */

import { z } from 'zod';
import { StoryboardShotSchema } from '../../types.js';

export const ShotCompositionOutputSchema = z.object({
  episodeNumber: z.number().default(1),
  shots: z.array(StoryboardShotSchema).describe('规划出的电影分镜头序列'),
});

export type ShotCompositionOutput = z.infer<typeof ShotCompositionOutputSchema>;
