/**
 * skills/story-bible/types.ts
 * 故事世界观圣经技能业务强类型契约 (Story Bible Types SSOT)
 */

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
  imageUrl?: string;
}

export interface StoryBibleParams {
  idea?: string; // 创作者核心故事构思
  style?: string; // 影调视觉风格
  userFeedback?: string; // 临时反馈与增量指示
  targetEpisodes?: number;
}

export interface StoryBibleArtifact {
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
  createdAt: string;
}
