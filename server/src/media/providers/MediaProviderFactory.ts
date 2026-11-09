/**
 * media/providers/MediaProviderFactory.ts
 * 媒体提供商工厂门面 (Media Provider Factory)
 */

import { config } from '../../utils/config.js';
import type { IImageProvider } from './ImageProvider.js';
import { ComfyUIMediaProvider } from './ComfyUIMediaProvider.js';
import { MockImageProvider } from './MockImageProvider.js';

export class MediaProviderFactory {
  private static imageProviderInstance?: IImageProvider;

  public static getImageProvider(): IImageProvider {
    if (!this.imageProviderInstance) {
      if (config.image.provider === 'mock' || process.env.NODE_ENV === 'test') {
        this.imageProviderInstance = new MockImageProvider();
      } else {
        this.imageProviderInstance = new ComfyUIMediaProvider();
      }
    }
    return this.imageProviderInstance;
  }

  public static setImageProvider(provider: IImageProvider): void {
    this.imageProviderInstance = provider;
  }
}
