import { z } from 'zod';
import { PoseConstraintSchema } from '../../../../../project-store/contracts/film-production/lookdev.js';

export const LookdevInputSchema = z.object({
  projectId: z.string().min(1).describe('项目唯一标识'),
  targetKind: z.enum(['character', 'location', 'item']).describe('定妆资产类型：角色、场景或道具'),
  targetId: z.string().min(1).describe('该资产在 lookdev_entities 中的唯一 ID'),
  instruction: z.string().optional().describe('创作者对该资产的修改要求'),
  customPrompt: z.string().optional().describe('单资产精修时使用的完整生图提示词'),
  customNegativePrompt: z.string().optional().describe('单资产精修时使用的负向提示词'),
  poseConstraint: PoseConstraintSchema.optional().describe('角色站姿约束；要求双脚并拢时使用 feet_together'),
  referenceImageUrls: z.array(z.string()).optional().describe('单资产精修时使用的参考图'),
  force: z.boolean().default(false).describe('是否强制重新生成已有图片'),
});

export const LookdevStepInputSchema = LookdevInputSchema.extend({ _context: z.any().optional() });

export const LookdevOutputSchema = z.object({
  projectId: z.string(),
  targetKind: LookdevInputSchema.shape.targetKind,
  targetId: z.string(),
  mediaUrl: z.string().optional(),
  versionId: z.string().optional(),
  renderedCount: z.number(),
  reviewStatus: z.enum(['pending', 'accepted']).optional(),
});

export type LookdevInput = z.infer<typeof LookdevInputSchema>;
export type LookdevOutput = z.infer<typeof LookdevOutputSchema>;
export type LookdevTarget = LookdevInput;
