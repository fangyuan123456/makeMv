/**
 * media/providers/MediaProviderFactory.ts
 * 视听媒体模型生成中枢工厂 (Media Provider Factory SSOT)
 *
 * 核心机制：
 * 1. 单一事实来源 (SSOT)：统一管理文生图与生视频 Provider 单例；
 * 2. 智能自愈：若配了 API Key 且非全局强制 MOCK_MODE，自动选用 DashScope 真实服务；
 * 3. 增强可测试性：提供 reset()、setImageProvider()、setVideoProvider() 支持单测沙箱与 Mock 注入；
 * 4. 零破坏兼容：严格遵循 NodeNext .js 规范。
 */

import { config } from '../../utils/config.js';
import type { IImageProvider } from './ImageProvider.js';
import type { IVideoProvider } from './VideoProvider.js';
import { DashScopeMediaProvider } from './DashScopeMediaProvider.js';
import { ComfyUIMediaProvider } from './ComfyUIMediaProvider.js';

export class MediaProviderFactory {
  private static imageProviderInstance?: IImageProvider | null;
  private static videoProviderInstance?: IVideoProvider | null;

  /**
   * 重置 Provider 缓存（用于单元测试沙箱隔离）
   */
  public static reset(): void {
    this.imageProviderInstance = undefined;
    this.videoProviderInstance = undefined;
  }

  /**
   * 显式注入生图 Provider (测试夹具)
   */
  public static setImageProvider(provider: IImageProvider | null): void {
    this.imageProviderInstance = provider;
  }

  /**
   * 显式注入生视频 Provider (测试夹具)
   */
  public static setVideoProvider(provider: IVideoProvider | null): void {
    this.videoProviderInstance = provider;
  }

  /**
   * 获取当前生效的文生图 Provider
   * @returns IImageProvider 实例；若无可用 Key 或为 mock 模式则返回 null (平滑降级)
   */
  public static getImageProvider(): IImageProvider | null {
    if (this.imageProviderInstance !== undefined) {
      return this.imageProviderInstance;
    }

    let providerType = config.image.provider;

    // 优先匹配 ComfyUI 机床 (由本地/云端服务直接驱动，无需 API Key)
    if (providerType === 'comfyui') {
      this.imageProviderInstance = new ComfyUIMediaProvider(config.comfyui.baseUrl);
      return this.imageProviderInstance;
    }
    const apiKey = config.image.apiKey || process.env.DASHSCOPE_API_KEY || (providerType === 'dashscope' ? config.llm.apiKey : '');

    // 智能自愈：若配了 API Key 且非全局强制 MOCK_MODE，自动选用 DashScope 真实服务，消灭配置遗漏陷阱
    if (providerType === 'mock' && apiKey && !config.mockMode) {
      console.log(`[MediaProviderFactory] ⚡ 检测到已配置有效 API Key，自动启用 DashScope 真实生图服务`);
      providerType = 'dashscope';
    } else if (providerType === 'mock' && apiKey && config.mockMode) {
      console.warn(`[MediaProviderFactory] ⚠️ 已配置生图 Key，但系统处于全局 MOCK_MODE，生图将走离线预演`);
    }

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

    let providerType = config.video.provider;

    // 优先匹配 ComfyUI 机床 (由本地/云端服务直接驱动，无需 API Key)
    if (providerType === 'comfyui') {
      this.videoProviderInstance = new ComfyUIMediaProvider(config.comfyui.baseUrl);
      return this.videoProviderInstance;
    }
    const apiKey = config.video.apiKey || process.env.DASHSCOPE_API_KEY || (providerType === 'dashscope' ? config.llm.apiKey : '');

    // 智能自愈：若配了 API Key 且非全局强制 MOCK_MODE，自动选用 DashScope 真实服务，消灭配置遗漏陷阱
    if (providerType === 'mock' && apiKey && !config.mockMode) {
      console.log(`[MediaProviderFactory] ⚡ 检测到已配置有效 API Key，自动启用 DashScope 真实生视频服务`);
      providerType = 'dashscope';
    } else if (providerType === 'mock' && apiKey && config.mockMode) {
      console.warn(`[MediaProviderFactory] ⚠️ 已配置生视频 Key，但系统处于全局 MOCK_MODE，生视频将走离线预演`);
    }

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
