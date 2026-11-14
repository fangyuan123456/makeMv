/**
 * agents/film-production/03-video-studio/lookdev/steps/character-portrait/schema.ts
 * 角色立绘定妆强类型契约
 */

import { z } from 'zod';

export const CharacterPortraitInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  characterId: z.string().describe('角色唯一标识'),
  force: z.boolean().default(false).describe('是否强制重绘'),
  customPrompt: z.string().optional().describe('创作者手动调整的提示词'),
  customNegativePrompt: z.string().optional().describe('创作者手动调整的负向词'),
  referenceImageUrls: z.array(z.string()).optional().describe('创作者指定的参考图 URLs'),
});

export const CharacterPortraitOutputSchema = z.object({
  projectId: z.string(),
  characterId: z.string(),
  imageUrl: z.string().optional().describe('生成的角色立绘母本图 URL'),
  diskPath: z.string().optional(),
  reused: z.boolean(),
  success: z.boolean(),
});

export type CharacterPortraitInput = z.infer<typeof CharacterPortraitInputSchema>;
export type CharacterPortraitOutput = z.infer<typeof CharacterPortraitOutputSchema>;
