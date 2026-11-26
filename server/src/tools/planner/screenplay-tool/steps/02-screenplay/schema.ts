/**
 * tools/planner/screenplay-tool/steps/02-screenplay/schema.ts
 * 步骤二：全景剧本创作专属契约 (Screenplay Step Contract)
 */

import { z } from 'zod';
import {
  PremiseOutputSchema,
  ScreenplayCharacterSchema,
  type PremiseOutput,
  type ScreenplayCharacter,
} from '../01-premise/schema.js';

export const ScreenplayOutputSchema = PremiseOutputSchema.extend({
  scriptMarkdown: z.string().describe('完整的 Markdown 格式互动影游全景剧本 (含分幕、台词、抉择选项与分支终局)'),
});

export type ScreenplayOutput = z.infer<typeof ScreenplayOutputSchema>;

export const FullScriptTextOutputSchema = z.object({
  scriptMarkdown: z.string().describe('完整的 Markdown 互动影游剧本正文'),
});

export type FullScriptTextOutput = z.infer<typeof FullScriptTextOutputSchema>;

export const ScreenplayStepInputSchema = PremiseOutputSchema.extend({
  _context: z.any().optional(),
  userPrompt: z.string().optional(),
});

export type ScreenplayStepInput = z.infer<typeof ScreenplayStepInputSchema>;
