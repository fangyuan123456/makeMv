/**
 * agents/doctor/steps/prompt-rewriter/schema.ts
 */

import { z } from 'zod';

export const PromptRewriterOutputSchema = z.object({
  rewrittenPrompt: z.string().describe('经过脱敏、精炼或格式修复后的安全提示词'),
  changesExplanation: z.string().describe('修改修改要点说明'),
});

export type PromptRewriterOutput = z.infer<typeof PromptRewriterOutputSchema>;
