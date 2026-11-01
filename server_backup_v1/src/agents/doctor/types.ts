/**
 * agents/doctor/types.ts
 * 质检与自愈智能体强类型契约 (Doctor Agent SSOT)
 */

import { z } from 'zod';

export interface DoctorDiagnosisInput {
  stage: string;
  model: string;
  error: string;
  originalPrompt: string;
  context?: string;
  validationError?: string;
  projectId?: string;
}

export interface DoctorDiagnosisResult {
  matched: boolean;
  reason_type: 'prompt_safety' | 'prompt_too_long' | 'prompt_format' | 'quota_or_network' | 'unknown';
  tool: 'rewrite_prompt' | 'none';
  should_retry: boolean;
  confidence: number;
  reason: string;
  rewrittenPrompt?: string;
}

export const DoctorDiagnosisResultSchema = z.object({
  matched: z.boolean(),
  reason_type: z.enum(['prompt_safety', 'prompt_too_long', 'prompt_format', 'quota_or_network', 'unknown']),
  tool: z.enum(['rewrite_prompt', 'none']),
  should_retry: z.boolean(),
  confidence: z.number(),
  reason: z.string(),
  rewrittenPrompt: z.string().optional(),
});
