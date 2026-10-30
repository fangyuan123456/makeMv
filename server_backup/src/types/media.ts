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
