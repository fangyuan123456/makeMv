/**
 * tools/film-production/shot-motion-prompt-tool/modifier/schema.ts
 * 单镜视频动态与运镜提示词微调契约
 */

import { z } from 'zod';
import { ShotMotionPromptOutputSchema } from '../steps/01-motion-prompt/schema.js';

export const ShotMotionPromptModifierInputSchema = z.object({
  mode: z.literal('modify').optional().describe('固定微调标识'),
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识'),
  shotId: z.string().describe('镜头唯一标识'),
  instruction: z.string().optional().describe('导演定向微调要求（如动作速率、人物随动、镜头推拉）'),
  customVideoPrompt: z.string().optional().describe('创作者直接指定的视频动态词'),
});

export type ShotMotionPromptModifierInput = z.infer<typeof ShotMotionPromptModifierInputSchema>;
export type ShotMotionPromptModifierOutput = z.infer<typeof ShotMotionPromptOutputSchema>;
