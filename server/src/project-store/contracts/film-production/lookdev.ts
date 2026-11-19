import { z } from 'zod';

export const PoseConstraintSchema = z.object({
  stance: z.enum(['neutral', 'feet_together']).describe('neutral=自然直立；feet_together=双脚并拢、脚踝贴合'),
});

export type PoseConstraint = z.infer<typeof PoseConstraintSchema>;

export const ImageUpscaleMetaSchema = z.object({
  multiplier: z.number().describe('超分放大倍率，如 2 或 4'),
  upscaledAt: z.string().describe('超分完成 ISO 时间戳'),
  sourceVersionId: z.string().optional().describe('超分前源版本 ID'),
});

export type ImageUpscaleMeta = z.infer<typeof ImageUpscaleMetaSchema>;

export const LookdevVersionSchema = z.object({
  versionId: z.string().describe('版本唯一标识符，如 v_1794739200000'),
  imageUrl: z.string().describe('持久化媒体访问路径'),
  promptZh: z.string().optional().describe('生成该版本时使用的中文提示词'),
  referenceImageUrl: z.string().optional().describe('生成该版本时使用的参考图'),
  instruction: z.string().optional().describe('该版本的定向修改或超分说明'),
  reviewStatus: z.enum(['pending', 'accepted']).optional().describe('视觉修改候选版本的验收状态；旧版本无此字段'),
  poseConstraint: PoseConstraintSchema.optional().describe('该版本生成时使用的姿态约束'),
  upscale: ImageUpscaleMetaSchema.optional().describe('高清超分记录（SeedVR2），随版本绑定'),
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
      poseConstraint: PoseConstraintSchema.optional(),
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
      versions: z.array(LookdevVersionSchema).optional().default([]),
      selectedVersionId: z.string().optional(),
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

export const ExtractedEntitiesSchema = GlobalEntitiesSchema.extend({
  characters: z.array(GlobalEntitiesSchema.shape.characters.element.extend({
    poseConstraint: PoseConstraintSchema,
  })),
});

export type GlobalEntities = z.infer<typeof GlobalEntitiesSchema>;
