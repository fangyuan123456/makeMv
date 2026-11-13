/**
 * agents/text-game/steps/lookdev-extract/index.ts
 * 定妆第一段 · 提取（人 / 物 / 地三类母本说明书，不出图）
 */

export {
  lookdevExtractStep,
  executeLookdevExtractStep,
  createConceptArtDirectorAgent,
  LookdevExtractInputSchema,
  LookdevExtractOutputSchema,
  type LookdevExtractInput,
  type LookdevExtractOutput,
} from './step.js';

export {
  buildLookdevExtractSystemPrompt,
  buildLookdevExtractUserPrompt,
} from './prompt.js';
