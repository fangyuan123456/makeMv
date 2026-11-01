/**
 * llm/telemetry/types.ts
 * 遥测与计费领域类型契约
 */

export type CurrencyType = 'USD' | 'CNY';

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: CurrencyType;
}

export interface LLMUsageRecord {
  jobId?: string;
  stage?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs?: number;
  cost: number;
  currency: CurrencyType;
  timestamp: number;
}
