export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  targetWidth?: number;
  targetHeight?: number;
  style?: string;
  referenceImageUrl?: string;
}

export interface ImageGenerationResponse {
  url: string;
  localPath: string;
  provider: string;
  prompt: string;
  rewrite_result?: {
    stage?: string;
    model?: string;
    error?: string;
    original_prompt?: string;
    optimized_prompt?: string;
    doctor_reason_type?: string;
    doctor_reason?: string;
    confidence?: number;
  };
}

export interface VideoGenerationRequest {
  prompt: string;
  firstFrameImageUrl?: string;
  lastFrameImageUrl?: string;
  duration?: number;
  ratio?: string;
  resolution?: string;
  mode?: 'first_frame' | 'text_to_video';
}

export interface VideoGenerationResponse {
  url: string;
  localPath: string;
  duration: number;
  provider: string;
  taskId?: string;
  rewrite_result?: any;
}

export interface ReferenceGenerationArtifact {
  shots: Array<{
    shotId: string;
    imageUrl: string;
    localPath: string;
    prompt: string;
  }>;
}

export interface VideoPostClip {
  id?: string;
  shotId: string;
  videoUrl: string;
  localPath: string;
  duration: number;
  prompt?: string;
  selected?: string;
  versions?: string[];
  episode?: number;
  rewrite_result?: any;
}

export interface VideoPostFinalVideo {
  name: string;
  path: string;
  url?: string;
  episode?: number;
  duration?: number;
}

export interface VideoPostArtifact {
  clips: VideoPostClip[];
  totalClips: number;
  final_videos?: VideoPostFinalVideo[];
  final_video?: string;
  outputVideoPath?: string;
  outputVideoUrl?: string;
  totalDuration?: number;
  timelineJsonPath?: string;
  timelineJsonUrl?: string;
  resolution?: string;
}

export type VideoGenerationArtifact = VideoPostArtifact;
export type PostProductionArtifact = VideoPostArtifact;
