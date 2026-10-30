export interface DoctorDiagnosisInput {
  stage: string;
  model: string;
  error: string;
  originalPrompt: string;
  context?: string;
  validationError?: string;
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
