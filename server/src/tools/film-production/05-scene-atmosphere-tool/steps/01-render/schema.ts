/**
 * tools/film-production/05-scene-atmosphere-tool/steps/01-render/schema.ts
 */

import { z } from 'zod';

export const SceneAtmosphereStepInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  locationId: z.string().describe('场景唯一标识'),
  force: z.boolean().default(false).describe('是否强制重绘'),
  customPrompt: z.string().optional().describe('创作者手动调整的提示词'),
  customNegativePrompt: z.string().optional().describe('创作者手动调整的负向词'),
  referenceImageUrls: z.array(z.string()).optional().describe('创作者指定的参考图 URLs'),
});

export const SceneAtmosphereStepOutputSchema = z.object({
  projectId: z.string(),
  locationId: z.string(),
  imageUrl: z.string().optional().describe('生成的场景空镜母本图 URL'),
  diskPath: z.string().optional(),
  reused: z.boolean(),
  success: z.boolean(),
});

export type SceneAtmosphereStepInput = z.infer<typeof SceneAtmosphereStepInputSchema>;
export type SceneAtmosphereStepOutput = z.infer<typeof SceneAtmosphereStepOutputSchema>;
