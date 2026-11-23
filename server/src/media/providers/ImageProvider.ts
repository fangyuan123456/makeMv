/**
 * media/providers/ImageProvider.ts
 * 文生图模型提供商抽象接口 (Image Provider SSOT)
 */

export interface ImageGenerationOptions {
  requestId?: string;
  size?: '1024*1024' | '720*1280' | '768*1344' | '1280*720' | '1536*768' | string;
  n?: number;
  negativePrompt?: string;
  seed?: number;
  abortSignal?: AbortSignal;
  referenceImageUrls?: string[];
  denoise?: number;
  maskImageUrl?: string;
  mode?:
    | 'character_t2i'
    | 'character_ref2i'
    | 'character_pose_outfit'
    | 'character_three_view'
    | 'scene_ref2i'
    | 'general_t2i';
}

export interface ImageUpscaleOptions {
  requestId?: string;
  /** 超分放大倍率（默认 2，可选 4） */
  multiplier?: number;
  /** 色彩校正方式（SeedVR2 官方原版默认 none，可选 lab / wavelet / adain） */
  colorCorrection?: 'none' | 'lab' | 'wavelet' | 'adain';
  seed?: number;
  abortSignal?: AbortSignal;
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

  /**
   * 使用超分模型（如 SeedVR2）对已有图片执行高清放大与细节增强
   */
  upscaleImage?(imageUrl: string, options?: ImageUpscaleOptions): Promise<string>;
}
