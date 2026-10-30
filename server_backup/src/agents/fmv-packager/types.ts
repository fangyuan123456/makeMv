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
