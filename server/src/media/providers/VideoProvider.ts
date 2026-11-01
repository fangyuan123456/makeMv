/**
 * media/providers/VideoProvider.ts
 * 视频生成模型提供商抽象接口 (Video Provider SSOT)
 */

export interface VideoGenerationOptions {
  referenceImageUrl?: string;
  durationSec?: number;
  resolution?: '480P' | '720P' | '1080P';
  aspectRatio?: '16:9' | '9:16';
}

export interface IVideoProvider {
  readonly name: string;

  /**
   * 根据提示词与首帧关键帧图生成动态视频切片
   * @param prompt 纯中文运镜与画面描述
   * @param options 视频生成参数
   * @returns 生成视频的临时 URL (由 MediaDownloader 负责下载持久化)
   */
  generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<string>;
}
