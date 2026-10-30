export interface VideoProductionClip {
  id?: string;
  shotId: string;
  videoUrl: string;
  localPath: string;
  duration: number;
  prompt: string;
  selected?: string;
  versions?: string[];
  episode?: number;
  rewrite_result?: any;
}

export interface VideoProductionArtifact {
  clips: VideoProductionClip[];
  totalClips: number;
}
