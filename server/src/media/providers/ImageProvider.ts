/**
 * media/providers/ImageProvider.ts
 * 文生图模型提供商抽象接口 (Image Provider SSOT)
 */

export interface ImageGenerationOptions {
  size?: '1024*1024' | '720*1280' | '1280*720' | string;
  n?: number;
  negativePrompt?: string;
  seed?: number;
  abortSignal?: AbortSignal;
  referenceImageUrl?: string;
  outfitImageUrl?: string;
  mode?: 'character_t2i' | 'character_ref2i' | 'character_pose_outfit' | 'character_three_view' | 'general_t2i';
}

export interface IImageProvider {
  readonly name: string;

  /**
   * 根据纯中文/英文专业影视提示词生成高清图像
   * @param prompt 提示词
   * @param options 生图参数
   * @returns 生成图像的临时或本地 URL (由 MediaDownloader 负责持久化)
   */
  generateImage(prompt: string, options?: ImageGenerationOptions): Promise<string>;
}
