/**
 * tools/film-production/07-shot-video-tool/steps/01-render/schema.ts
 */

import { z } from 'zod';

export const ShotVideoStepInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('所属分幕 ID'),
  shotId: z.string().describe('镜头 ID'),
  force: z.boolean().default(false).describe('是否强制重绘'),
  customPrompt: z.string().optional().describe('创作者手动调整的视频表演运镜词'),
  referenceImageUrl: z.string().optional().describe('指定作为视频起始首帧的参考图 URL'),
});

export const ShotVideoStepOutputSchema = z.object({
  projectId: z.string(),
  clipId: z.string(),
  shotId: z.string(),
  videoUrl: z.string().optional(),
  reused: z.boolean(),
  success: z.boolean(),
});

export type ShotVideoStepInput = z.infer<typeof ShotVideoStepInputSchema>;
export type ShotVideoStepOutput = z.infer<typeof ShotVideoStepOutputSchema>;
