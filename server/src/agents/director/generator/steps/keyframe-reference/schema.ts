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
  /**
   * 生成时上游内容的指纹（镜头画面字段 + 出镜角色视觉字段）。
   * 由 provenance.ts 在 setArtifact 边界统一补齐，模型不输出此字段。
   * 缺失表示老数据或上游不全，陈旧判定按 unknown 处理。
   */
  inputFingerprint: z.string().optional(),
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
