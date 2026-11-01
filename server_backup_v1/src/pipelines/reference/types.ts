/**
 * pipelines/reference/types.ts
 * 互动影游关键帧图生图与提示词增强契约 (Reference SSOT)
 */

import { z } from 'zod';

export interface ReferenceGenerationShot {
  shotId: string;
  imageUrl: string;
  localPath: string;
  prompt: string;
  rewrite_result?: any;
}

export interface ReferenceGenerationArtifact {
  shots: ReferenceGenerationShot[];
}

export const ReferenceGenerationShotSchema = z.object({
  shotId: z.string(),
  imageUrl: z.string(),
  localPath: z.string(),
  prompt: z.string(),
  rewrite_result: z.any().optional(),
});

export const ReferenceGenerationArtifactSchema = z.object({
  shots: z.array(ReferenceGenerationShotSchema),
});

/**
 * 关键帧工步输入契约 (Data In ➔ Data Out)
 */
export interface PromptEnhancementInput {
  shots: any[];
  characters: Array<{
    name: string;
    role: string;
    appearancePrompt: string;
    clothingPrompt?: string;
  }>;
  style: string;
  userFeedback?: string;
  abortSignal?: AbortSignal;
}

export interface ImageBatchRenderInput {
  projectId: string;
  shots: any[];
  promptMap: Map<string, string>;
  abortSignal?: AbortSignal;
}
