/**
 * agents/pipeline/workflows/steps/video-production/schema.ts
 * 动态视频切片生成 Zod 契约规约 (Video Production Zod SSOT)
 */

import { z } from 'zod';

export const KeyPoseItemSchema = z.object({
  poseIndex: z.number().describe('姿态序号 (从 0 开始)'),
  timestampSec: z.number().describe('时间轴卡点秒数 (如 0.0s, 1.5s, 3.0s)'),
  poseName: z.string().describe('姿态简述 (如: 蓄力拔剑 / 剑刃出鞘 / 回锋收式)'),
  poseDescription: z.string().describe('微观肢体与动态构图细节'),
  poseImageUrl: z.string().optional().describe('姿态关键帧预览图 URL'),
});

export type KeyPoseItem = z.infer<typeof KeyPoseItemSchema>;

export const VideoClipItemSchema = z.object({
  clipId: z.string().describe('切片标识'),
  shotId: z.string().describe('绑定的分镜头标识 (如 shot_1)'),
  videoUrl: z.string().describe('本地或云端视频切片永久回放 URL'),
  durationSec: z.number().describe('视频切片持续秒数'),
  resolution: z.string().describe('视频分辨率 (如 720P / 1080P)'),
  ratio: z.string().describe('画面比例 (如 16:9)'),
  status: z.literal('rendered').describe('渲染完成状态'),
  isDegraded: z.boolean().optional().describe('是否本地离线降级生成'),
  degradedReason: z.string().optional().describe('降级原因说明'),
  keyPoses: z.array(KeyPoseItemSchema).optional().describe('动作姿态分解序列 (用于动作级精修与预演)'),
  renderMode: z.enum(['direct_i2v', 'pose_breakdown']).optional().describe('渲染模式：直接I2V或动作姿态分解预演'),
  characterPrompt: z.string().optional().describe('特定角色面貌提示词 (用于角色替换/微调)'),
});

export type VideoClipItem = z.infer<typeof VideoClipItemSchema>;

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
