/**
 * skills/keyframe-reference/schema.ts
 * 关键帧首帧参考图 Zod 契约规约 (Keyframe Reference Zod SSOT)
 */

import { z } from 'zod';

// 1. 单个分镜提示词推演项 Schema
export const KeyframePromptItemSchema = z.object({
  shotId: z.string().describe('镜头标识，如 shot_1'),
  prompt: z.string().describe('纯中文电影级高质感首帧画面生图提示词'),
});

export const KeyframeBatchOutputSchema = z.object({
  keyframes: z.array(KeyframePromptItemSchema).describe('分镜首帧提示词推演清单'),
});

export type KeyframeBatchOutput = z.infer<typeof KeyframeBatchOutputSchema>;

// 2. 单个关键帧成品条目
export const KeyframeItemSchema = z.object({
  shotId: z.string(),
  shotNumber: z.number(),
  prompt: z.string(),
  imageUrl: z.string(),
  remoteImageUrl: z.string().optional(),
  aspectRatio: z.string(),
  status: z.enum(['rendered', 'ready']),
});

export type KeyframeItem = z.infer<typeof KeyframeItemSchema>;

// 3. 完整关键帧工序落盘产物 Schema
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
