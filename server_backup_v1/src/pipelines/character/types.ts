/**
 * pipelines/character/types.ts
 * 互动影游角色设计强类型数据契约 (Character Design SSOT)
 */

import type { BaseAgentInput } from '../../types/index.js';
import type { CharacterProfile } from '../narrative/types.js';
import type { VisualSpecData } from './steps/visual-spec/schema.js';

export interface VisualSpec {
  name: string;
  role: string;
  positivePrompt: string;
  negativePrompt: string;
  lighting: string;
  shotType: string;
  aspectRatio: string;
  clothingDetails: string;
  facialFeatures: string;
}

export interface CharacterVersion {
  versionId: string;
  imageUrl: string;
  localPath: string;
  score?: number;
  evalSummary?: string;
  createdAt: string;
}

export interface CharacterSheet extends CharacterProfile {
  visualSpec?: VisualSpec;
  currentVersionId?: string;
  versions: CharacterVersion[];
}

export interface CharacterDesignerInput extends BaseAgentInput {
  targetCharacterNames?: string[];
  styleOverride?: string;
  versionsPerCharacter?: number;
}

export interface CharacterDesignArtifact {
  characters: CharacterSheet[];
  totalCharacters: number;
  completedCharacters: number;
  style: string;
  createdAt: string;
}

/**
 * 角色定妆工步输入数据契约 (Data In ➔ Data Out)
 */
export interface VisualSpecInput {
  rawCharacters: CharacterProfile[];
  style: string;
  userFeedback?: string;
  abortSignal?: AbortSignal;
}

export interface PortraitRenderInput {
  projectId: string;
  rawCharacters: CharacterProfile[];
  specs: VisualSpecData[];
  versionsPerCharacter?: number;
  abortSignal?: AbortSignal;
}

export interface QualityEvalInput {
  characterSheets: CharacterSheet[];
  abortSignal?: AbortSignal;
}
