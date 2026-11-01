/**
 * media/providers/ImageProvider.ts
 * 文生图模型提供商抽象接口 (Image Provider SSOT)
 */

export interface ImageGenerationOptions {
  size?: '1024*1024' | '720*1280' | '1280*720' | string;
  n?: number;
  negativePrompt?: string;
  seed?: number;
}

export interface IImageProvider {
  readonly name: string;

  /**
   * 根据纯中文专业影视提示词生成高清图像
   * @param prompt 纯中文提示词
   * @param options 生图参数
   * @returns 生成图像的临时 URL (由 MediaDownloader 负责下载持久化)
   */
  generateImage(prompt: string, options?: ImageGenerationOptions): Promise<string>;
}
