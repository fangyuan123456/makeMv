/**
 * pipelines/packaging/types.ts
 * 互动影游最终产物打包与引擎清单规范 (FMV Packager SSOT)
 */

import { z } from 'zod';

export interface FMVNodeAsset {
  nodeId: string;
  title: string;
  videoUrl: string;
  localPath: string;
  durationSec: number;
  decisionTimeSec?: number;
  holdImageUrl?: string;
  loopVideoUrl?: string;
  isDecisionPoint: boolean;
  choices?: any[];
}

export interface FMVManifest {
  gameTitle: string;
  startNodeId: string;
  totalDurationSec: number;
  nodes: Record<string, FMVNodeAsset>;
}

export interface FmvFinalVideo {
  name: string;
  path: string;
  url: string;
  episode?: number;
  duration?: number;
}

export interface FmvPackagerArtifact {
  final_video: string;
  outputVideoPath: string;
  outputVideoUrl: string;
  final_videos: FmvFinalVideo[];
  totalDuration: number;
  resolution: string;
  fmvManifest?: FMVManifest;
}

export const FMVNodeAssetSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  videoUrl: z.string(),
  localPath: z.string(),
  durationSec: z.number(),
  decisionTimeSec: z.number().optional(),
  holdImageUrl: z.string().optional(),
  loopVideoUrl: z.string().optional(),
  isDecisionPoint: z.boolean(),
  choices: z.array(z.any()).optional(),
});

export const FMVManifestSchema = z.object({
  gameTitle: z.string(),
  startNodeId: z.string(),
  totalDurationSec: z.number(),
  nodes: z.record(z.string(), FMVNodeAssetSchema),
});

export const FmvPackagerArtifactSchema = z.object({
  final_video: z.string(),
  outputVideoPath: z.string(),
  outputVideoUrl: z.string(),
  final_videos: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      url: z.string(),
      episode: z.number().optional(),
      duration: z.number().optional(),
    })
  ),
  totalDuration: z.number(),
  resolution: z.string(),
  fmvManifest: FMVManifestSchema.optional(),
});

/**
 * 打包工步输入契约 (Data In ➔ Data Out)
 */
export interface MasterAssemblyInput {
  projectId: string;
  clips: any[];
}

export interface MasterCutResult {
  outputVideoPath: string;
  outputVideoUrl: string;
  finalVideos: FmvFinalVideo[];
  totalDuration: number;
}

export interface ManifestPackagingInput {
  projectId: string;
  gameTitle: string;
  resolution?: string;
  shots: any[];
  sceneChoicesMap: Map<string, any[]>;
  masterCut: MasterCutResult;
}
