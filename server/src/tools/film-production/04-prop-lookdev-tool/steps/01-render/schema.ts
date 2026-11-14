/**
 * tools/film-production/04-prop-lookdev-tool/steps/01-render/schema.ts
 * 道具特写定妆专属契约 (Prop Lookdev Step Contract)
 */

import { z } from 'zod';

export const PropLookdevInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  itemId: z.string().describe('待渲染道具 ID'),
  customPrompt: z.string().optional().describe('创作者手动微调的生图提示词'),
  customNegativePrompt: z.string().optional().describe('创作者微调的负向提示词'),
  referenceImageUrls: z.array(z.string()).optional().describe('外部参考图或垫图 URL 列表'),
  force: z.boolean().default(false).describe('是否强制重新物理生成'),
});

export type PropLookdevInput = z.infer<typeof PropLookdevInputSchema>;

export const PropLookdevOutputSchema = z.object({
  itemId: z.string().describe('道具 ID'),
  propImageUrl: z.string().describe('生成的道具特写高清图媒体 URL'),
  promptZh: z.string().describe('实际使用的中文生图提示词'),
});

export type PropLookdevOutput = z.infer<typeof PropLookdevOutputSchema>;

export const PropLookdevStepInputSchema = PropLookdevInputSchema.extend({
  _context: z.any().optional(),
});

export type PropLookdevStepInput = z.infer<typeof PropLookdevStepInputSchema>;
