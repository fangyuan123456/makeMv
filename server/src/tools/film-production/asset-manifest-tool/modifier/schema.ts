/**
 * tools/film-production/asset-manifest-tool/modifier/schema.ts
 * 资产骨架清单微调契约 (Asset Manifest Modifier Contract SSOT)
 */

import { z } from 'zod';
import {
  AssetManifestOutputSchema,
  ManifestCharacterItemSchema,
  ManifestLocationItemSchema,
  ManifestItemItemSchema,
} from '../steps/01-manifest/index.js';

export const ManifestModificationItemSchema = z.object({
  action: z.enum(['add', 'delete', 'rename', 'update']).describe('操作类型'),
  entityKind: z.enum(['character', 'location', 'item']).describe('实体类别'),
  targetId: z.string().optional().describe('已有实体的 ID（delete/rename/update 时使用）'),
  name: z.string().optional().describe('实体名称（旧名称或当前名称）'),
  newName: z.string().optional().describe('重命名时的新名称'),
  entity: z.union([
    ManifestCharacterItemSchema.partial(),
    ManifestLocationItemSchema.partial(),
    ManifestItemItemSchema.partial(),
  ]).optional().describe('新增或更新的实体内容'),
});

export type ManifestModificationItem = z.infer<typeof ManifestModificationItemSchema>;

export const AssetManifestModifierInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  instruction: z.string().optional().describe('创作者自然语言修改指令（如：新增女主角苏青、删除杂货铺）'),
  modifications: z.array(ManifestModificationItemSchema).optional().describe('结构化增删改操作清单（零 LLM 消耗高精度执行）'),
  storyMarkdown: z.string().optional().describe('剧本或故事正文 Markdown'),
  prd: z.any().optional().describe('策划案 PRD'),
});

export type AssetManifestModifierInput = z.infer<typeof AssetManifestModifierInputSchema>;

export const AssetManifestModifierOutputSchema = AssetManifestOutputSchema;
export type AssetManifestModifierOutput = z.infer<typeof AssetManifestModifierOutputSchema>;
