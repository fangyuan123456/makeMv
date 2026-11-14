/**
 * agents/film-production/03-video-studio/lookdev/steps/prop-lookdev/schema.ts
 */

import { z } from 'zod';

export const PropLookdevInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  itemId: z.string().describe('道具唯一标识'),
  force: z.boolean().default(false).describe('是否强制重绘'),
  customPrompt: z.string().optional().describe('创作者手动调整的提示词'),
  customNegativePrompt: z.string().optional().describe('创作者手动调整的负向词'),
  referenceImageUrls: z.array(z.string()).optional().describe('创作者指定的参考图 URLs'),
});

export const PropLookdevOutputSchema = z.object({
  projectId: z.string(),
  itemId: z.string(),
  imageUrl: z.string().optional().describe('生成的道具特写母本图 URL'),
  diskPath: z.string().optional(),
  reused: z.boolean(),
  success: z.boolean(),
});

export type PropLookdevInput = z.infer<typeof PropLookdevInputSchema>;
export type PropLookdevOutput = z.infer<typeof PropLookdevOutputSchema>;
