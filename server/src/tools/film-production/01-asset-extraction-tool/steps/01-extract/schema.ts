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
  mode: z.enum(['extract', 'modify']).default('extract').describe('extract=从剧本提取；modify=增删已有角色或场景'),
  modifications: z
    .array(
      z.object({
        operation: z.enum(['add', 'delete']).optional().describe('对视觉资产执行新增或删除'),
        action: z.enum(['add', 'delete']).optional().describe('operation 的兼容别名'),
        entityType: z.enum(['character', 'location']).describe('角色或场景'),
        entityId: z.string().optional().describe('删除时优先使用的实体 ID'),
        name: z.string().optional().describe('实体名称；新增必填，删除时可作为名称匹配'),
        entity: z.record(z.any()).optional().describe('新增实体的详细设定字段'),
      })
    )
    .optional()
    .describe('mode=modify 时的增删操作列表'),
  instruction: z.string().optional().describe('mode=modify 时的人工干预指令；机器人会结合剧本与 PRD 重新提取并补齐视觉资产'),
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
