/**
 * agents/film-production/01-asset-extraction/schema.ts
 * 视觉资产提取强类型契约 (Asset Extraction Schema SSOT)
 */

import { z } from 'zod';
import {
  GlobalEntitiesSchema,
  type GlobalEntities,
} from '../../../project-store/contracts/film-production/lookdev.js';
import { UniversalPrdSpecSchema } from '../../../project-store/contracts/planner/index.js';

export const AssetExtractionInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().describe('故事标题'),
  prd: UniversalPrdSpecSchema.describe('通用策划案 PRD 规范'),
  storyMarkdown: z.string().describe('按幕剧本全文 story.md，人物与道具以剧本中实际出现的为准'),
});

export type AssetExtractionInput = z.infer<typeof AssetExtractionInputSchema>;

export const AssetExtractionOutputSchema = z.object({
  entities: GlobalEntitiesSchema.describe('提取出的全剧角色 / 道具 / 场景字典 (含纯文本外观与提示词，不生图)'),
});

export type AssetExtractionOutput = z.infer<typeof AssetExtractionOutputSchema>;

export { GlobalEntitiesSchema, type GlobalEntities };
