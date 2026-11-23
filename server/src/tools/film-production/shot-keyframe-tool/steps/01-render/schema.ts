/**
 * tools/film-production/shot-keyframe-tool/steps/01-render/schema.ts
 */

import { z } from 'zod';

export const ShotKeyframeStepInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().optional().describe('所属分幕 ID'),
  shotId: z.string().optional().describe('镜头 ID (可选，留空则自动对全剧未生成关键帧批量生成)'),
  frame: z.enum(['first', 'last']).optional().describe('单镜头定向重绘的目标帧：first（首帧）或 last（末帧）；留空则按镜头模式生成'),
  force: z.boolean().default(false).describe('是否强制重绘'),
  customPrompt: z.string().optional().describe('创作者手动调整的关键帧生图词'),
  customNegativePrompt: z.string().optional().describe('创作者手动调整的负向词'),
  referenceImageUrls: z.array(z.string()).optional().describe('创作者上传或指定的垫图参考图 URLs'),
  instruction: z.string().optional().describe('基于当前帧的定向微调要求（有值时本次出图记为 refine 版本）'),
  maskImageUrl: z.string().optional().describe('局部重绘或精准擦除的黑白遮罩蒙版图片 URL'),
  denoise: z.number().min(0.01).max(1.0).optional().describe('自适应去噪强度（微调通常 0.45~0.60，全量重构 1.0）'),
  continuityMode: z.enum(['auto', 'linked', 'detached']).optional().describe('前序镜头连续性模式：auto（AI智能同场景连贯）、linked（强制承接上镜尾帧）、detached（独立机位断开）'),
});

export const ShotKeyframeStepOutputSchema = z.object({
  projectId: z.string(),
  clipId: z.string().optional(),
  shotId: z.string().optional(),
  firstFrameImageUrl: z.string().optional(),
  lastFrameImageUrl: z.string().optional(),
  reused: z.boolean().optional(),
  success: z.boolean(),
});

export type ShotKeyframeStepInput = z.infer<typeof ShotKeyframeStepInputSchema>;
export type ShotKeyframeStepOutput = z.infer<typeof ShotKeyframeStepOutputSchema>;
