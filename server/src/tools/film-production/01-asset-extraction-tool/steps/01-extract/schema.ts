/**
 * tools/film-production/01-asset-extraction-tool/steps/01-extract/schema.ts
 * 视觉资产提炼工序专属契约 (Asset Extraction Step Contract)
 */

import { z } from 'zod';
import {
  GlobalEntitiesSchema,
  type GlobalEntities,
} from '../../../../../project-store/contracts/film-production/lookdev.js';

export const AssetExtractionInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().optional().describe('故事标题'),
  prd: z.any().optional().describe('策划案 PRD (UniversalPrdSpec)'),
  storyMarkdown: z.string().optional().describe('分段剧本或故事正文 Markdown'),
});

export type AssetExtractionInput = z.infer<typeof AssetExtractionInputSchema>;

export const AssetExtractionOutputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  entities: GlobalEntitiesSchema.describe('结构化视觉资产总表 (包含角色、道具、场景外观设定)'),
});

export type AssetExtractionOutput = z.infer<typeof AssetExtractionOutputSchema>;

export const AssetExtractionStepInputSchema = AssetExtractionInputSchema.extend({
  _context: z.any().optional(),
});

export type AssetExtractionStepInput = z.infer<typeof AssetExtractionStepInputSchema>;
