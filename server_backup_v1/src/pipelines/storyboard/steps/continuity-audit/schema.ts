/**
 * pipelines/storyboard/steps/continuity-audit/schema.ts
 */

import { z } from 'zod';

export const ContinuityAuditPatchSchema = z.object({
  shot_number: z.number().describe('镜头序号（从1开始）'),
  content: z.string().describe('修正后的画面描述与站位'),
});

export const ContinuityAuditOutputSchema = z.object({
  issues: z.array(z.string()).default([]),
  patches: z.array(ContinuityAuditPatchSchema).default([]),
});

export type ContinuityAuditOutput = z.infer<typeof ContinuityAuditOutputSchema>;
