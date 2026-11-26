/**
 * media/providers/VideoProvider.ts
 * 视频生成模型提供商抽象接口 (Video Provider SSOT)
 */

export interface VideoGenerationOptions {
  requestId?: string;
  mode?: 'i2v' | 'ref2v';
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  lastFrameImageUrl?: string;
  audioPrompt?: string;
  duration?: number;
  fps?: number;
  resolution?: '480P' | '720P' | '1080P' | string;
  abortSignal?: AbortSignal;
}

export interface IVideoProvider {
  readonly name: string;
  generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<string>;
}
