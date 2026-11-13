/**
 * agents/film-production/schema.ts
 * 影视视听切片资产订单强类型 Zod 契约 (Film Asset Order Schema SSOT)
 *
 * 核心设计：
 * 1. 与文游节点一对一锚定；
 * 2. 包含可直接喂给物理工具 (SD/Runway/ComfyUI/TTS) 的精确参数；
 * 3. 包含时间轴交互激活窗口与无缝剪辑接点 (Match Cut)。
 */

import { z } from 'zod';

export const CinematicShotOrderSchema = z.object({
  shotId: z.string().describe('镜头唯一标识，如 S1-01'),
  clipId: z.string().describe('所属伪视频/分幕 ID，如 S1'),
  shotIndex: z.number().int().nonnegative().describe('镜头在分幕内的顺序，从 0 开始'),
  durationSec: z.number().positive().describe('镜头目标时长（秒）'),
  shotType: z.string().describe('景别与机位，如 CLOSE_UP / MEDIUM_SHOT / WIDE_SHOT'),
  cameraMovement: z.string().describe('拍摄方式与运镜，如 locked-off / dolly in / tracking'),
  generationMode: z.enum(['first_frame', 'first_last_frame']).describe('关键帧生成模式'),
  characters: z.array(z.string()).default([]).describe('本镜头出场角色 ID'),
  items: z.array(z.string()).default([]).describe('本镜头使用道具 ID'),
  backgroundImageUrl: z.string().optional().describe('本镜头使用的场景母本图'),
  characterReferenceImageUrls: z.array(z.string()).default([]).describe('本镜头角色定妆图'),
  firstFramePrompt: z.string().describe('首帧图片生成描述词'),
  lastFramePrompt: z.string().optional().describe('首尾帧模式的尾帧图片生成描述词'),
  videoPrompt: z.string().describe('从关键帧生成视频的动作、表演与运镜描述词'),
  audioPrompt: z.string().describe('与视频同步生成的环境声、动作声、音乐氛围与对白表现描述词'),
  firstFrameImageUrl: z.string().optional().describe('生成后的首帧图片 URL'),
  lastFrameImageUrl: z.string().optional().describe('生成后的尾帧图片 URL'),
  firstFrameEnhancedUrl: z.string().optional(),
  lastFrameEnhancedUrl: z.string().optional(),
  videoUrl: z.string().optional().describe('生成后的镜头视频 URL'),
  dialogue: z.string().default('').describe('本镜头对白或旁白'),
  ambience: z.string().default('').describe('本镜头环境声与氛围音'),
  transitionAnchor: z.string().describe('与前后镜头衔接的动作、视线或构图锚点'),
});

export const CinematicClipOrderSchema = z.object({
  clipId: z.string().describe('切片唯一标识，与剧本/文游节点 1:1 锚定，如 S1, S1.1'),
  sourceNodeId: z.string().describe('对应的文游节点 ID'),
  targetDurationSec: z.number().default(5.0).describe('分幕目标总时长（秒）'),
  shots: z.array(CinematicShotOrderSchema).min(1).describe('该伪视频拆出的镜头清单'),
  videoUrl: z.string().optional().describe('该分幕最终合成视频 URL，供 game-assembly 播放'),
});

export const FilmAdapterArtifactSchema = z.object({
  projectId: z.string().optional(),
  schemaVersion: z.string().default('1.0.0'),
  projectTitle: z.string().describe('作品名称'),
  clips: z.array(CinematicClipOrderSchema).min(1).describe('全量待渲染视听切片需求清单'),
});

export type CinematicClipOrder = z.infer<typeof CinematicClipOrderSchema>;
export type CinematicShotOrder = z.infer<typeof CinematicShotOrderSchema>;
export type FilmAdapterArtifact = z.infer<typeof FilmAdapterArtifactSchema>;
