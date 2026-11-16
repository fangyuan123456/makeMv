import { z } from 'zod';

export const LookdevVersionSchema = z.object({
  versionId: z.string().describe('版本唯一标识符，如 v_1794739200000'),
  imageUrl: z.string().describe('持久化媒体访问路径'),
  promptZh: z.string().optional().describe('生成该版本时使用的中文提示词'),
  referenceImageUrl: z.string().optional().describe('生成该版本时使用的参考图'),
  createdAt: z.string().describe('版本创建时间戳'),
});

export type LookdevVersion = z.infer<typeof LookdevVersionSchema>;

export const GlobalEntitiesSchema = z.object({
  artStyle: z.string(),
  characters: z.array(
    z.object({
      characterId: z.string(),
      name: z.string(),
      identity: z.string(),
      appearanceSummary: z.string(),
      promptZh: z.string(),
      referenceImageUrl: z.string().optional(),
      imageUrl: z.string().optional(),
      versions: z.array(LookdevVersionSchema).optional().default([]),
      selectedVersionId: z.string().optional(),
    })
  ),
  items: z.array(
    z.object({
      itemId: z.string(),
      name: z.string(),
      description: z.string(),
      appearanceSummary: z.string(),
      promptZh: z.string(),
      referenceImageUrl: z.string().optional(),
      imageUrl: z.string().optional(),
    })
  ),
  locations: z.array(
    z.object({
      locationId: z.string(),
      name: z.string(),
      atmosphere: z.string(),
      appearanceSummary: z.string(),
      promptZh: z.string(),
      sceneIds: z.array(z.string()).default([]),
      referenceImageUrl: z.string().optional(),
      imageUrl: z.string().optional(),
      versions: z.array(LookdevVersionSchema).optional().default([]),
      selectedVersionId: z.string().optional(),
    })
  ).default([]),
});

export type GlobalEntities = z.infer<typeof GlobalEntitiesSchema>;
