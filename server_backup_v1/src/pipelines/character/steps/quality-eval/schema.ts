/**
 * pipelines/character/steps/quality-eval/schema.ts
 * 角色定妆画质与人设契合度质检 Schema (Zod SSOT)
 */

import { z } from 'zod';

export const CharacterEvalScoreSchema = z.object({
  characterName: z.string(),
  versionId: z.string(),
  fidelityScore: z.number().min(0).max(100).describe('人设外貌契合度评分 (0-100)'),
  photorealismScore: z.number().min(0).max(100).describe('电影质感与摄影真实度评分 (0-100)'),
  flawsDetected: z.array(z.string()).describe('排查出的肢体畸变、画面瑕疵或人设冲突点'),
  summary: z.string().describe('质检综合评语'),
});

export const QualityEvalBatchSchema = z.object({
  evaluations: z.array(CharacterEvalScoreSchema),
  recommendedVersionId: z.string().describe('系统推荐选用的最优版本 ID'),
});

export type CharacterEvalScore = z.infer<typeof CharacterEvalScoreSchema>;
export type QualityEvalBatchData = z.infer<typeof QualityEvalBatchSchema>;
