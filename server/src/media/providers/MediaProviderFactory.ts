/**
 * media/providers/MediaProviderFactory.ts
 * 视听媒体模型生成中枢工厂 (Media Provider Factory SSOT)
 */

import { config } from '../../utils/config.js';
import type { IImageProvider } from './ImageProvider.js';
import type { IVideoProvider } from './VideoProvider.js';
import { DashScopeMediaProvider } from './DashScopeMediaProvider.js';

export class MediaProviderFactory {
  private static imageProviderInstance?: IImageProvider | null;
  private static videoProviderInstance?: IVideoProvider | null;

  /**
   * 获取当前生效的文生图 Provider
   * @returns IImageProvider 实例；若无可用 Key 或为 mock 模式则返回 null (平滑降级)
   */
  public static getImageProvider(): IImageProvider | null {
    if (this.imageProviderInstance !== undefined) {
      return this.imageProviderInstance;
    }

    const providerType = config.image.provider;
    const apiKey = config.image.apiKey || process.env.DASHSCOPE_API_KEY || (providerType === 'dashscope' ? config.llm.apiKey : '');

    if (providerType === 'mock' || !apiKey) {
      this.imageProviderInstance = null;
      return null;
    }

    // 默认或指定为 dashscope / wanx
    this.imageProviderInstance = new DashScopeMediaProvider({
      apiKey,
      baseUrl: config.image.baseUrl,
      imageModel: config.image.model,
    });

    return this.imageProviderInstance;
  }

  /**
   * 获取当前生效的生视频 Provider
   * @returns IVideoProvider 实例；若无可用 Key 或为 mock 模式则返回 null (平滑降级)
   */
  public static getVideoProvider(): IVideoProvider | null {
    if (this.videoProviderInstance !== undefined) {
      return this.videoProviderInstance;
    }

    const providerType = config.video.provider;
    const apiKey = config.video.apiKey || process.env.DASHSCOPE_API_KEY || (providerType === 'dashscope' ? config.llm.apiKey : '');

    if (providerType === 'mock' || !apiKey) {
      this.videoProviderInstance = null;
      return null;
    }

    this.videoProviderInstance = new DashScopeMediaProvider({
      apiKey,
      baseUrl: config.video.baseUrl,
      videoModel: config.video.model,
    });

    return this.videoProviderInstance;
  }
}
