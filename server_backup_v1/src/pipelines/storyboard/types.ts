/**
 * pipelines/storyboard/types.ts
 * 互动影游分镜与镜头设计强类型契约 (Storyboard SSOT)
 */

import { z } from 'zod';

export interface StoryboardShot {
  shotId: string;
  unitId: string;
  sceneId: string;
  shotType: '近景' | '中景' | '全景' | '特写';
  duration: number; // in seconds
  cameraAngle: string;
  cameraMovement: string;
  charactersInShot: string[];
  visualContent: string;
  dialogueOrAction: string;
  imagePrompt: string;
  videoPrompt: string;
  firstFrameImageUrl?: string;
  videoClipUrl?: string;
  voiceoverAudioUrl?: string;
}

export interface StoryboardSegment {
  segment_id: string;
  segment_number: number;
  episode_number: number;
  location: string;
  characters: string[];
  total_duration: number;
  shots: Array<{
    shot_number: number;
    shot_type: string;
    duration: number;
    content: string;
  }>;
}

export interface StoryboardEpisode {
  episode_number: number;
  episode_title: string;
  segments: StoryboardSegment[];
}

export interface StoryboardArtifact {
  episodeNumber?: number;
  shots: StoryboardShot[];
  totalDuration?: number;
  episodes?: StoryboardEpisode[];
}

export const StoryboardShotSchema = z.object({
  shotId: z.string(),
  unitId: z.string(),
  sceneId: z.string(),
  shotType: z.enum(['近景', '中景', '全景', '特写']),
  duration: z.number(),
  cameraAngle: z.string(),
  cameraMovement: z.string(),
  charactersInShot: z.array(z.string()),
  visualContent: z.string(),
  dialogueOrAction: z.string(),
  imagePrompt: z.string(),
  videoPrompt: z.string(),
});

export const StoryboardArtifactSchema = z.object({
  episodeNumber: z.number().optional(),
  shots: z.array(StoryboardShotSchema),
  totalDuration: z.number().optional(),
});

/**
 * 分镜工步输入/输出强类型契约 (Data In ➔ Data Out)
 */
export interface ShotCompositionInput {
  title: string;
  theme: string;
  scriptText?: string;
  characterVisuals: Array<{
    name: string;
    role: string;
    appearancePrompt: string;
    clothingPrompt?: string;
    negativePrompt?: string;
  }>;
  scenes: Array<{
    sceneId: string;
    title: string;
    location: string;
    characters: string[];
    actions: string;
  }>;
  userFeedback?: string;
  abortSignal?: AbortSignal;
}

export interface ShotCompositionResult {
  rawShots: StoryboardShot[];
  episodeNumber: number;
}

export interface ContinuityAuditInput {
  rawShots: StoryboardShot[];
  episodeNumber: number;
  title: string;
  scenes: Array<{
    sceneId: string;
    title: string;
    location: string;
    characters?: string[];
  }>;
  abortSignal?: AbortSignal;
}
