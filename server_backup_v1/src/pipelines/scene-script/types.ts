/**
 * pipelines/scene-script/types.ts
 * 互动影游剧本分场强类型契约 (Scene Script SSOT)
 */

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
  time: string;
  space: '内' | '外';
  location: string;
  characters: string[];
  items: ScriptItem[];
  choices?: FMVBranchChoice[];
}

export interface ScriptEpisode {
  episodeNumber: number;
  title: string;
  logline: string;
  targetDuration?: number;
  cliffhanger?: string;
  status?: 'planned' | 'running' | 'completed';
  content?: string;
  scenes?: ScriptScene[];
}

export interface SceneScriptArtifact {
  title: string;
  theme: string;
  style: string;
  episodes: ScriptEpisode[];
  characterNames: string[];
  locations: string[];
  scriptText?: string;
  rawText?: string;
  activeEpisodeNumber?: number;
  isLocked?: boolean;
}

export const ScriptItemSchema = z.object({
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
});

export const FMVBranchChoiceSchema = z.object({
  id: z.string(),
  choiceText: z.string(),
  targetSceneId: z.string(),
  description: z.string().optional(),
  requiredClues: z.array(z.string()).optional(),
});

export const ScriptSceneSchema = z.object({
  sceneId: z.string(),
  title: z.string(),
  time: z.string(),
  space: z.enum(['内', '外']),
  location: z.string(),
  characters: z.array(z.string()),
  items: z.array(ScriptItemSchema),
  choices: z.array(FMVBranchChoiceSchema).optional(),
});

export const ScriptEpisodeSchema = z.object({
  episodeNumber: z.number(),
  title: z.string(),
  logline: z.string(),
  cliffhanger: z.string().optional(),
  scenes: z.array(ScriptSceneSchema),
});

export const SceneScriptArtifactSchema = z.object({
  title: z.string(),
  theme: z.string(),
  style: z.string(),
  episodes: z.array(ScriptEpisodeSchema),
  characterNames: z.array(z.string()),
  locations: z.array(z.string()),
  scriptText: z.string().optional(),
  activeEpisodeNumber: z.number().optional(),
  isLocked: z.boolean().optional(),
});

/**
 * 剧本工步输入/输出契约 (Data In ➔ Data Out)
 */
export interface ScreenplayExpansionInput {
  title: string;
  theme: string;
  style: string;
  episodeNumber?: number;
  characters: any[];
  storyGraph?: any;
  userFeedback?: string;
  abortSignal?: AbortSignal;
}

export interface ScreenplayExpansionResult {
  title: string;
  logline: string;
  cliffhanger?: string;
  screenplayMarkdown: string;
  episodeNumber: number;
}

export interface SceneStructuringInput {
  title: string;
  theme: string;
  style: string;
  characterNames: string[];
  expansion: ScreenplayExpansionResult;
  storyGraph?: any;
  abortSignal?: AbortSignal;
}
