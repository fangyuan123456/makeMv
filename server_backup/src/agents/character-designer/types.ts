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
  gender?: string;
  age?: string;
  role: string;
  personality: string;
  motivation?: string;
  affinityTrigger?: string;
  appearancePrompt: string;
  clothingPrompt: string;
  visualPrompt?: string;
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

export const CharacterDesignSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  personality: z.string(),
  appearancePrompt: z.string(),
  clothingPrompt: z.string(),
  imagePrompt: z.string().optional(),
  imageUrl: z.string().optional(),
});

export const CharacterDesignArtifactSchema = z.object({
  characters: z.array(CharacterDesignSchema),
  settings: z.array(z.any()).optional(),
});
