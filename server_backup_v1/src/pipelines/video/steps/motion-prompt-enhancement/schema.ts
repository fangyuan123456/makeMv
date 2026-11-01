/**
 * pipelines/video/steps/motion-prompt-enhancement/schema.ts
 */

import { z } from 'zod';

export const EnhancedMotionPromptSchema = z.object({
  shotId: z.string(),
  motionPrompt: z.string().describe('结合运镜轨迹、演员微动作与时间流动的视频生成动态指令'),
});

export const MotionPromptEnhancementOutputSchema = z.object({
  enhancedPrompts: z.array(EnhancedMotionPromptSchema),
});

export type MotionPromptEnhancementOutput = z.infer<typeof MotionPromptEnhancementOutputSchema>;
