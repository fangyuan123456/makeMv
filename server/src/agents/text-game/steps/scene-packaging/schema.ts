/**
 * agents/text-game/steps/scene-packaging/schema.ts
 * 分幕自包含切片打包工序契约 (Scene Packaging Schema SSOT)
 */

import { z } from 'zod';
import { SingleSceneJsonSchema, type SingleSceneJson, GlobalEntitiesSchema, type GlobalEntities } from '../../schema.js';
import { UniversalPrdSpecSchema } from '../../../planner/steps/prd-synthesis/schema.js';

export const ScenePackagingInputSchema = z.object({
  title: z.string().describe('短剧标题'),
  prd: UniversalPrdSpecSchema.describe('Step 4 唯一事实来源通用策划案 PRD'),
  storyMarkdown: z.string().describe('Step 4 交付的按幕剧本全文 story.md（与 prd.clips[].id 1:1 对齐）'),
  entities: GlobalEntitiesSchema.describe('角色一致性与道具字典'),
});

export type ScenePackagingInput = z.infer<typeof ScenePackagingInputSchema>;

export const ScenePackagingOutputSchema = z.object({
  scenes: z.array(SingleSceneJsonSchema).min(1).describe('全剧所有自包含分幕 JSON 数组'),
  summary: z.string().describe('打包汇聚总结，如场景总数与首尾流转关系'),
});

export type ScenePackagingOutput = z.infer<typeof ScenePackagingOutputSchema>;
