/**
 * agents/pipeline/workflows/steps/keyframe-reference/schema.ts
 * 关键帧首帧参考图 Zod 契约规约 (Keyframe Reference Zod SSOT)
 */

import { z } from 'zod';

export const KeyframePromptItemSchema = z.object({
  shotId: z.string().describe('镜头标识，如 shot_1'),
  subjectAppearance: z.string().optional().describe('角色人物静态外貌与长相（仅文生首帧图锁定像素，严禁传入后续视频生成）'),
  sceneEnvironment: z.string().optional().describe('场景空间物理环境与光影氛围（供首帧图与后续视频动量共享）'),
  prompt: z.string().describe('纯中文电影级高质感首帧画面生图完整提示词 (结合了外貌与环境)'),
});

export const KeyframeBatchOutputSchema = z.object({
  keyframes: z.array(KeyframePromptItemSchema).describe('分镜首帧提示词推演清单'),
});

export type KeyframeBatchOutput = z.infer<typeof KeyframeBatchOutputSchema>;

export const KeyframeItemSchema = z.object({
  shotId: z.string(),
  shotNumber: z.number(),
  subjectAppearance: z.string().optional(),
  sceneEnvironment: z.string().optional(),
  prompt: z.string(),
  imageUrl: z.string(),
  remoteImageUrl: z.string().optional(),
  aspectRatio: z.string(),
  status: z.enum(['rendered', 'ready']),
  isDegraded: z.boolean().optional(),
  degradedReason: z.string().optional(),
});

export type KeyframeItem = z.infer<typeof KeyframeItemSchema>;

export const KeyframeReferenceArtifactSchema = z.object({
  shots: z.array(KeyframeItemSchema),
  totalKeyframes: z.number(),
  completedKeyframes: z.number(),
  isRefinement: z.boolean().optional(),
  targetShotId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type KeyframeReferenceArtifact = z.infer<typeof KeyframeReferenceArtifactSchema>;
