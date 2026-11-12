/**
 * agents/text-game/steps/image-gen-pool/schema.ts
 * 并发视觉资产池生图工序契约 (Image Gen Pool Schema SSOT)
 */

import { z } from 'zod';
import { SingleSceneJsonSchema, GlobalEntitiesSchema } from '../../schema.js';

export const ImageGenPoolInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  scenes: z.array(SingleSceneJsonSchema).min(1).describe('分幕独立切片 JSON 数组'),
  entities: GlobalEntitiesSchema.describe('角色一致性与道具字典'),
  concurrency: z.number().default(4).describe('并发池工作槽位数 (默认 4)'),
  force: z.boolean().optional().default(false).describe('是否强制覆盖重新生成'),
  forceSceneIds: z
    .array(z.string())
    .optional()
    .describe('只强制重生成指定幕（玩家替换角色/道具母本图后按幕失效，不整剧重烧算力）'),
});

export type ImageGenPoolInput = z.infer<typeof ImageGenPoolInputSchema>;

export const ImageGenPoolOutputSchema = z.object({
  projectId: z.string(),
  totalScenes: z.number(),
  renderedCount: z.number(),
  skippedCount: z.number(),
  failedCount: z.number().describe('生图失败并落占位图的场景数，重跑时必须重新尝试'),
  entities: GlobalEntitiesSchema.describe('已回填母本图 URL 的实体字典'),
  scenes: z.array(SingleSceneJsonSchema).describe('已回填本地图片路径的分幕切片数组'),
});

export type ImageGenPoolOutput = z.infer<typeof ImageGenPoolOutputSchema>;
