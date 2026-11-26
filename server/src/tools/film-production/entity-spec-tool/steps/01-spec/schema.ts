/**
 * tools/film-production/entity-spec-tool/steps/01-spec/schema.ts
 * 单实体视觉规格精细化推演契约 (Single Entity Spec Contract SSOT)
 */

import { z } from 'zod';
import { CharacterSpecSchema } from '../../character/index.js';
import { LocationSpecSchema } from '../../location/index.js';
import { ItemSpecSchema } from '../../item/index.js';

export * from '../../character/schema.js';
export * from '../../location/schema.js';
export * from '../../item/schema.js';

export const EntitySpecInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  targetKind: z.enum(['character', 'location', 'item']).describe('实体类别：character=角色，location=场景，item=道具'),
  targetId: z.string().optional().describe('实体 ID'),
  name: z.string().describe('实体法定全名'),
  roleOrBrief: z.string().optional().describe('清单中的身份定位或一句话概述'),
  instruction: z.string().optional().describe('推演指导意见'),
  storyMarkdown: z.string().optional().describe('剧本或故事正文 Markdown'),
  prd: z.any().optional().describe('策划案 PRD (UniversalPrdSpec)'),
});

export type EntitySpecInput = z.infer<typeof EntitySpecInputSchema>;

export const EntitySpecOutputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  targetKind: z.enum(['character', 'location', 'item']).describe('实体类别'),
  targetId: z.string().describe('实体唯一标识'),
  name: z.string().describe('实体名称'),
  character: CharacterSpecSchema.optional().describe('若为角色，返回完整角色设定'),
  location: LocationSpecSchema.optional().describe('若为场景，返回完整场景设定'),
  item: ItemSpecSchema.optional().describe('若为道具，返回完整道具设定'),
});

export type EntitySpecOutput = z.infer<typeof EntitySpecOutputSchema>;
