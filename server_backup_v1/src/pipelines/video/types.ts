/**
 * pipelines/video/types.ts
 * 互动影游视频片段生成与渲染契约 (Video Production SSOT)
 */

import { z } from 'zod';

export interface VideoProductionClip {
  id?: string;
  shotId: string;
  videoUrl: string;
  localPath: string;
  duration: number;
  prompt: string;
  selected?: string;
  versions?: string[];
  episode?: number;
  rewrite_result?: any;
}

export interface VideoProductionArtifact {
  clips: VideoProductionClip[];
  totalClips: number;
}

export const VideoProductionClipSchema = z.object({
  id: z.string().optional(),
  shotId: z.string(),
  videoUrl: z.string(),
  localPath: z.string(),
  duration: z.number(),
  prompt: z.string(),
  selected: z.string().optional(),
  versions: z.array(z.string()).optional(),
  episode: z.number().optional(),
  rewrite_result: z.any().optional(),
});

export const VideoProductionArtifactSchema = z.object({
  clips: z.array(VideoProductionClipSchema),
  totalClips: z.number(),
});

/**
 * 视频生产工步输入契约 (Data In ➔ Data Out)
 */
export interface MotionPromptEnhancementInput {
  shots: any[];
  style: string;
  userFeedback?: string;
  abortSignal?: AbortSignal;
}

export interface VideoBatchRenderInput {
  projectId: string;
  shots: any[];
  motionPromptMap: Map<string, string>;
  abortSignal?: AbortSignal;
}
