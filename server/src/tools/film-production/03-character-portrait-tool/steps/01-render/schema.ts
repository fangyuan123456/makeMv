/**
 * tools/film-production/03-character-portrait-tool/steps/01-render/schema.ts
 * 角色全身立绘渲染专属契约 (Character Portrait Step Contract)
 */

import { z } from 'zod';

export const CharacterPortraitInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  characterId: z.string().describe('待渲染角色 ID'),
  customPrompt: z.string().optional().describe('创作者手动微调的生图提示词'),
  customNegativePrompt: z.string().optional().describe('创作者微调的负向提示词'),
  referenceImageUrls: z.array(z.string()).optional().describe('外部参考图或垫图 URL 列表'),
  force: z.boolean().default(false).describe('是否强制重新物理生成'),
});

export type CharacterPortraitInput = z.infer<typeof CharacterPortraitInputSchema>;

export const CharacterPortraitOutputSchema = z.object({
  characterId: z.string().describe('角色 ID'),
  portraitImageUrl: z.string().describe('生成的角色立绘持久化媒体 URL'),
  promptZh: z.string().describe('实际使用的中文生图提示词'),
});

export type CharacterPortraitOutput = z.infer<typeof CharacterPortraitOutputSchema>;

export const CharacterPortraitStepInputSchema = CharacterPortraitInputSchema.extend({
  _context: z.any().optional(),
});

export type CharacterPortraitStepInput = z.infer<typeof CharacterPortraitStepInputSchema>;
