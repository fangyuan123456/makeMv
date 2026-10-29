import { z } from 'zod';

export interface CharacterEvaluation {
  score: number;
  isAcceptable: boolean;
  hardFailures?: string[];
  softIssues?: string[];
  issues?: string[];
  suggestion?: string;
}

export interface CharacterDesign {
  id: string;
  name: string;
  age?: string;
  role: string;
  personality: string;
  appearancePrompt: string;
  clothingPrompt: string;
  imagePrompt?: string;
  imageUrl?: string;
  selected?: string;
  versions?: string[];
  referenceImageUrl?: string;
  rewrite_result?: any;
  evaluation?: CharacterEvaluation;
}

export interface SettingDesign {
  id: string;
  location: string;
  space: '内' | '外';
  atmospherePrompt: string;
  lightingPrompt: string;
  imagePrompt?: string;
  imageUrl?: string;
  selected?: string;
  versions?: string[];
}

export interface CharacterDesignArtifact {
  characters: CharacterDesign[];
  settings?: SettingDesign[];
}

export interface StoryboardShot {
  shotId: string;
  unitId: string;
  sceneId: string;
  shotType: '近景' | '中景' | '全景' | '特写';
  duration: number; // in seconds
  cameraAngle: string; // e.g. "平视机位", "俯拍", "微仰"
  cameraMovement: string; // e.g. "固定", "缓慢推近", "平移"
  charactersInShot: string[];
  visualContent: string;
  dialogueOrAction: string;
  imagePrompt: string;
  videoPrompt: string;
  firstFrameImageUrl?: string;
  videoClipUrl?: string;
  voiceoverAudioUrl?: string;
  lastFrameImageUrl?: string;
}

export interface StoryboardArtifact {
  episodeNumber: number;
  shots: StoryboardShot[];
  totalDuration: number;
  episodes?: any[];
}
