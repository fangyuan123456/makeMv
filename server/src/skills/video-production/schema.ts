/**
 * skills/video-production/schema.ts
 * 动态视频切片生成 Zod 契约规约 (Video Production Zod SSOT)
 */

import { z } from 'zod';

// 1. 单个视频切片条目 Schema
export const VideoClipItemSchema = z.object({
  clipId: z.string().describe('切片标识'),
  shotId: z.string().describe('绑定的分镜头标识 (如 shot_1)'),
  videoUrl: z.string().describe('本地或云端视频切片永久回放 URL'),
  durationSec: z.number().describe('视频切片持续秒数'),
  resolution: z.string().describe('视频分辨率 (如 720P / 1080P)'),
  ratio: z.string().describe('画面比例 (如 16:9)'),
  status: z.literal('rendered').describe('渲染完成状态'),
});

export type VideoClipItem = z.infer<typeof VideoClipItemSchema>;

// 2. 动态视频生产工序最终落盘产物 Schema
export const VideoProductionArtifactSchema = z.object({
  clips: z.array(VideoClipItemSchema),
  totalClips: z.number(),
  completedClips: z.number(),
  totalDurationSec: z.number(),
  isRefinement: z.boolean().optional(),
  targetShotId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type VideoProductionArtifact = z.infer<typeof VideoProductionArtifactSchema>;
