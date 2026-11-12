/**
 * media/providers/MediaProviderFactory.ts
 * 媒体提供商工厂门面 (Media Provider Factory)
 */

import { config } from '../../utils/config.js';
import type { IImageProvider } from './ImageProvider.js';
import type { IVideoProvider } from './VideoProvider.js';
import { ComfyUIMediaProvider } from './ComfyUIMediaProvider.js';
import { MockImageProvider } from './MockImageProvider.js';

export class MediaProviderFactory {
  private static imageProviderInstance?: IImageProvider;
  private static videoProviderInstance?: IVideoProvider;
  private static sharedComfyInstance?: ComfyUIMediaProvider;

  private static getComfyProvider(): ComfyUIMediaProvider {
    if (!this.sharedComfyInstance) {
      this.sharedComfyInstance = new ComfyUIMediaProvider();
    }
    return this.sharedComfyInstance;
  }

  public static getImageProvider(): IImageProvider {
    if (!this.imageProviderInstance) {
      if (config.image.provider === 'mock' || process.env.NODE_ENV === 'test') {
        this.imageProviderInstance = new MockImageProvider();
      } else {
        this.imageProviderInstance = this.getComfyProvider();
      }
    }
    return this.imageProviderInstance;
  }

  public static getVideoProvider(): IVideoProvider {
    if (!this.videoProviderInstance) {
      this.videoProviderInstance = this.getComfyProvider();
    }
    return this.videoProviderInstance;
  }

  public static setImageProvider(provider: IImageProvider): void {
    this.imageProviderInstance = provider;
  }

  public static setVideoProvider(provider: IVideoProvider): void {
    this.videoProviderInstance = provider;
  }
}
