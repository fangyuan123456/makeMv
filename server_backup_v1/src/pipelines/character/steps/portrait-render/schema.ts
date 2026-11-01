/**
 * pipelines/character/steps/portrait-render/schema.ts
 * 定妆照渲染与版本数据契约 (Zod SSOT)
 */

import { z } from 'zod';

export const CharacterVersionSchema = z.object({
  versionId: z.string().describe('定妆版本唯一 ID，如 v1, v2'),
  imageUrl: z.string().describe('持久化媒体访问地址，如 /media/:projectId/characters/...'),
  localPath: z.string().describe('本地磁盘绝对路径'),
  promptUsed: z.string().optional().describe('本次生成实际使用的正向提示词'),
  createdAt: z.string().describe('生成时间戳'),
});

export const PortraitRenderResultSchema = z.object({
  characterName: z.string(),
  versions: z.array(CharacterVersionSchema).min(1),
  primaryImageUrl: z.string(),
});

export type CharacterVersionData = z.infer<typeof CharacterVersionSchema>;
export type PortraitRenderResult = z.infer<typeof PortraitRenderResultSchema>;
