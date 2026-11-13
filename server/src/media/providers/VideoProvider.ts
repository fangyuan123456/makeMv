/**
 * media/providers/VideoProvider.ts
 * 视频生成模型提供商抽象接口 (Video Provider SSOT)
 */

export interface VideoGenerationOptions {
  referenceImageUrl?: string;
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
