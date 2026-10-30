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

export interface StoryboardEpisode {
  episode_number: number;
  episode_title: string;
  segments: Array<{
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
  }>;
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
});
