/**
 * pipelines/narrative/types.ts
 * 互动影游叙事设计强类型数据契约 (Narrative Design SSOT)
 */

import type { BaseAgentInput } from '../../types/index.js';
import type { StorySpineData } from './steps/story-spine/schema.js';
import type { PivotPointsOutput } from './steps/pivot-points/schema.js';
import type { StoryGraphData } from './steps/story-graph/schema.js';

export interface GoldenSpineAct {
  act: number;
  name: string;
  summary: string;
  targetDurationSec?: number;
  cliffhanger?: string;
}

export interface MacroPivotPoint {
  id: string;
  act: number;
  decisionMoment: string;
  choices: Array<{
    choiceId: string;
    text: string;
    dramaticImpact: string;
    targetAct?: number;
  }>;
}

export interface MicroPivotPoint {
  id: string;
  sceneName: string;
  interactiveMechanic: string;
  feedback: string;
}

export interface PivotPointsData {
  macroPivotPoints: MacroPivotPoint[];
  microPivotPoints: MicroPivotPoint[];
}

export interface StoryGraphNodeChoice {
  targetNodeId: string;
  text: string;
  condition?: string;
  dramaticTension?: string;
}

export interface StoryGraphNode {
  id: string;
  act: number;
  title: string;
  summary: string;
  location: string;
  characterNames: string[];
  isEnding?: boolean;
  endingType?: 'good' | 'bad' | 'hidden' | 'neutral';
  choices: StoryGraphNodeChoice[];
}

export interface StoryGraph {
  rootNodeId: string;
  nodes: StoryGraphNode[];
  endingsCount: number;
  estimatedBranches: number;
  validation?: {
    isPass: boolean;
    issues: string[];
    warnings: string[];
    convergenceRate?: number;
  };
}

export interface CharacterProfile {
  name: string;
  role: string;
  gender?: string;
  age?: number | string;
  appearance: string;
  personality: string;
  motivation: string;
  arc?: string;
  visualPromptKeywords?: string[];
  referenceImageUrl?: string;
  imageUrl?: string;
  selected?: boolean;
  versions?: any[];
}

export interface StoryBible {
  title: string;
  theme: string;
  style: string;
  logline: string;
  sellingPoints: string[];
  goldenSpine: GoldenSpineAct[];
  characters: CharacterProfile[];
  storyGraph: StoryGraph;
  genreId?: string;
  genreName?: string;
}

export interface NarrativeInput extends BaseAgentInput {
  idea: string;
  style?: string;
  targetEpisodes?: number;
}

export interface NarrativeArtifact {
  title: string;
  theme: string;
  style: string;
  logline: string;
  sellingPoints: string[];
  goldenSpine: GoldenSpineAct[];
  pivotPoints: PivotPointsData;
  characters: CharacterProfile[];
  characterNames: string[];
  storyGraph: StoryGraph;
  bible: StoryBible;
  createdAt: string;
}

/**
 * 🌟 工步纯数据输入契约 (Bounded Step Inputs)
 */
export interface StorySpineInput {
  idea: string;
  style?: string;
  userFeedback?: string;
  abortSignal?: AbortSignal;
}

export interface PivotPointsInput {
  spine: StorySpineData;
  userFeedback?: string;
  abortSignal?: AbortSignal;
}

export interface StoryGraphInput {
  spine: StorySpineData;
  pivots: PivotPointsOutput;
  userFeedback?: string;
  abortSignal?: AbortSignal;
}

export interface CharacterProfilesInput {
  spine: StorySpineData;
  graph: StoryGraphData;
  userFeedback?: string;
  abortSignal?: AbortSignal;
}
