import { z } from 'zod';

export type StoryNodeType =
  | 'story'
  | 'decision'
  | 'qte'
  | 'investigation'
  | 'converge'
  | 'bad_end'
  | 'true_end';

export interface StoryNode {
  id: string;
  type: StoryNodeType;
  interactionMode?: string;
  title: string;
  summary: string;
  location: string;
  characters: string[];
  estimatedDurationSec: number;
  endingTitle?: string;
  hotspots?: any[];
  commMessage?: any;
  evidencePresent?: any;
}

export interface StoryChoiceCondition {
  requiredClues?: string[];
  minAffinity?: Record<string, number>;
  flagsRequired?: Record<string, boolean>;
}

export interface StoryChoiceEffects {
  affinityDelta?: Record<string, number>;
  gainItems?: string[];
  setFlags?: Record<string, boolean>;
}

export interface StoryChoice {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  choiceText: string;
  timeoutSeconds?: number;
  isTimeoutDefault?: boolean;
  conditions?: StoryChoiceCondition;
  effects?: StoryChoiceEffects;
}

export interface StoryGraphSystems {
  affinity: Record<string, number>;
  inventory: string[];
  flags: Record<string, boolean>;
}

export interface GraphValidationResult {
  isPass: boolean;
  unreachableNodes: string[];
  deadlockPaths: string[];
  leafNodes: string[];
  convergenceRate: number;
  totalEstimatedDurationSec: number;
  issues: string[];
  warnings: string[];
}

export interface InteractiveStoryGraph {
  startNodeId: string;
  systems: StoryGraphSystems;
  nodes: StoryNode[];
  choices: StoryChoice[];
  validation?: GraphValidationResult;
}

export interface CharacterProfile {
  id?: string;
  name: string;
  role: string;
  gender?: string;
  age?: number | string;
  personality?: string;
  appearance?: string;
  motivation?: string;
  visualPrompt?: string;
  affinityTrigger?: string;
  clothingPrompt?: string;
  imagePrompt?: string;
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


export interface GoldenSpineAct {
  act: number;
  name: string;
  dramaticFunction: string;
  summary: string;
  coreConflict: string;
  cliffhanger: string;
  targetDurationSec: number;
}

export interface StorySpineOutput {
  title: string;
  theme: string;
  style: string;
  logline: string;
  sellingPoints: string[];
  goldenSpine: GoldenSpineAct[];
}

export interface HotspotInspectionItem {
  id: string;
  label: string;
  action: string;
  feedback: string;
  itemReward?: string;
  clueReward?: string;
}

export interface MicroInteractionsSpec {
  hotspotsInspection: {
    actNumber: number;
    context: string;
    items: HotspotInspectionItem[];
  };
  commCall: {
    actNumber: number;
    caller: string;
    context: string;
    incomingDialog: string;
    quickReactions: string[];
  };
  emotionalReaction: {
    actNumber: number;
    context: string;
    confrontationPrompt: string;
    options: Array<{
      label: string;
      attitude: string;
      reaction: string;
    }>;
  };
  evidencePresentation: {
    actNumber: number;
    context: string;
    requiredItem: string;
    actionPrompt: string;
    successFeedback: string;
    failPunishment: string;
  };
}

export interface MacroPivotPoint {
  pivotId: string;
  actNumber: number;
  name: string;
  dramaticDilemma: string;
  timeoutSeconds: number;
  branches: Array<{
    choiceText: string;
    targetPath: string;
    dramaticOutcome: string;
    effects?: StoryChoiceEffects;
    isTimeoutDefault?: boolean;
    isBadEnd?: boolean;
    isTrueEnd?: boolean;
  }>;
}

export interface PivotPointsOutput {
  title: string;
  microInteractions: MicroInteractionsSpec;
  macroPivotPoints: MacroPivotPoint[];
}

export interface StoryBible {
  title: string;
  theme: string;
  style: string;
  logline: string;
  sellingPoints: string[];
  goldenSpine?: GoldenSpineAct[];
  characters: CharacterProfile[];
  episodePlans?: any[];
  isLocked?: boolean;
  genreId?: string;
  genreName?: string;
  genreReason?: string;
  storyGraph?: InteractiveStoryGraph;
}

export interface NarrativeDesignArtifact {
  title: string;
  theme: string;
  style: string;
  logline?: string;
  sellingPoints?: string[];
  goldenSpine?: GoldenSpineAct[];
  pivotPoints?: any[];
  bible?: StoryBible;
  characters: CharacterProfile[];
  characterNames: string[];
  episodes?: any[];
  locations: string[];
  genreId?: string;
  genreName?: string;
  genreReason?: string;
  storyGraph?: InteractiveStoryGraph;
  isLocked?: boolean;
}
