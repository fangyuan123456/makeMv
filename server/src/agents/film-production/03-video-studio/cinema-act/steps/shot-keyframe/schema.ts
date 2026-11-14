/**
 * agents/film-production/03-video-studio/cinema-act/steps/shot-keyframe/schema.ts
 */

import { z } from 'zod';

export const ShotKeyframeInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('所属分幕 ID'),
  shotId: z.string().describe('镜头 ID'),
  force: z.boolean().default(false).describe('是否强制重绘'),
  customPrompt: z.string().optional().describe('创作者手动调整的首帧生图词'),
  customNegativePrompt: z.string().optional().describe('创作者手动调整的负向词'),
  referenceImageUrls: z.array(z.string()).optional().describe('创作者上传或指定的垫图参考图 URLs'),
});

export const ShotKeyframeOutputSchema = z.object({
  projectId: z.string(),
  clipId: z.string(),
  shotId: z.string(),
  firstFrameImageUrl: z.string().optional(),
  lastFrameImageUrl: z.string().optional(),
  reused: z.boolean(),
  success: z.boolean(),
});

export type ShotKeyframeInput = z.infer<typeof ShotKeyframeInputSchema>;
export type ShotKeyframeOutput = z.infer<typeof ShotKeyframeOutputSchema>;
