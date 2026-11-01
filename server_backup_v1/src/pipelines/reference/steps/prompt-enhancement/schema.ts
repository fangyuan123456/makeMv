/**
 * pipelines/reference/steps/prompt-enhancement/schema.ts
 */

import { z } from 'zod';

export const EnhancedShotPromptSchema = z.object({
  shotId: z.string(),
  fullPrompt: z.string().describe('融合了角色视觉锚点、场景光影与画质控制的终极生图提示词'),
});

export const PromptEnhancementOutputSchema = z.object({
  enhancedShots: z.array(EnhancedShotPromptSchema),
});

export type PromptEnhancementOutput = z.infer<typeof PromptEnhancementOutputSchema>;
