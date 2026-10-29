import { z } from 'zod';

export interface ScriptDialogue {
  character: string;
  emotionPrompt?: string;
  text: string;
}

export interface ScriptAction {
  description: string;
  character?: string;
}

export interface ScriptItem {
  id: string;
  type: 'dialogue' | 'action';
  dialogue?: ScriptDialogue;
  action?: ScriptAction;
}

export interface FMVBranchChoice {
  id: string;
  choiceText: string;
  targetSceneId: string;
  description?: string;
  requiredClues?: string[];
}

export interface ScriptScene {
  sceneId: string;
  title: string;
  time: string; // e.g. "日" or "夜"
  space: '内' | '外';
  location: string;
  characters: string[];
  items: ScriptItem[];
  choices?: FMVBranchChoice[]; // FMV Interactive Branches
}

export interface CharacterProfile {
  name: string;
  role: string;
  personality?: string;
  appearance?: string;
  motivation?: string;
  referenceImageUrl?: string;
  imageUrl?: string;
  selected?: string;
  versions?: string[];
  evaluation?: {
    score: number;
    isAcceptable: boolean;
    issues?: string[];
    suggestion?: string;
  };
}

export interface EpisodePlan {
  episodeNumber: number;
  title: string;
  logline: string;
  targetDuration?: number; // in seconds, e.g. 60, 75, 90
  cliffhanger?: string; // 结尾卡点断章钩子
  status?: 'planned' | 'running' | 'completed';
  content?: string;
  scenes?: ScriptScene[];
}

export interface ScriptBible {
  title: string;
  theme: string;
  style: string;
  logline: string;
  sellingPoints: string[];
  characters: CharacterProfile[];
  episodePlans: EpisodePlan[];
  isLocked?: boolean;
  genreId?: string;
  genreName?: string;
  genreReason?: string;
}

export type ScriptEpisode = EpisodePlan;

export interface ScriptArtifact {
  title: string;
  theme: string;
  style: string;
  logline?: string;
  sellingPoints?: string[];
  bible?: ScriptBible;
  characters?: CharacterProfile[];
  episodes: ScriptEpisode[];
  characterNames: string[];
  locations: string[];
  scriptText?: string;
  rawText?: string;
  isLocked?: boolean;
  activeEpisodeNumber?: number;
  genreId?: string;
  genreName?: string;
  genreReason?: string;
}

export const ScriptArtifactSchema = z.object({
  title: z.string(),
  theme: z.string(),
  style: z.string(),
  episodes: z.array(
    z.object({
      episodeNumber: z.number(),
      title: z.string(),
      logline: z.string(),
      cliffhanger: z.string().optional(),
      scenes: z.array(
        z.object({
          sceneId: z.string(),
          title: z.string(),
          time: z.string(),
          space: z.enum(['内', '外']),
          location: z.string(),
          characters: z.array(z.string()),
          items: z.array(
            z.object({
              id: z.string(),
              type: z.enum(['dialogue', 'action']),
              dialogue: z
                .object({
                  character: z.string(),
                  emotionPrompt: z.string().optional(),
                  text: z.string(),
                })
                .optional(),
              action: z
                .object({
                  description: z.string(),
                  character: z.string().optional(),
                })
                .optional(),
            })
          ),
          choices: z
            .array(
              z.object({
                id: z.string(),
                choiceText: z.string(),
                targetSceneId: z.string(),
                description: z.string().optional(),
                requiredClues: z.array(z.string()).optional(),
              })
            )
            .optional(),
        })
      ),
    })
  ),
  characterNames: z.array(z.string()),
  locations: z.array(z.string()),
});
