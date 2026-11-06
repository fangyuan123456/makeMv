/**
 * media/KeyframeRenderer.ts
 * 分镜关键帧首帧基准图专属渲染器 (Keyframe Renderer SSOT)
 */

import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { MediaResolver } from './MediaResolver.js';
import { MediaDownloader } from './MediaDownloader.js';
import { MediaProviderFactory } from './providers/MediaProviderFactory.js';
import { FFmpegService } from './ffmpeg.js';

export interface KeyframeRenderResult {
  url: string;
  isDegraded: boolean;
  degradedReason?: string;
}

export class KeyframeRenderer {
  private static ffmpeg: FFmpegService = new FFmpegService();

  public static setFFmpegService(service: FFmpegService): void {
    KeyframeRenderer.ffmpeg = service;
  }

  public static getFFmpegService(): FFmpegService {
    return KeyframeRenderer.ffmpeg;
  }

  /**
   * 渲染并写入分镜头关键帧首帧基准图
   */
  public static async renderKeyframeImage(
    projectId: string,
    shotId: string,
    aspectRatio: string = '16:9',
    prompt?: string,
    options?: { isMock?: boolean; abortSignal?: AbortSignal }
  ): Promise<KeyframeRenderResult> {
    const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
    const targetDir = path.join(projectDir, 'keyframes');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const safeShotId = shotId.replace(/[^\w-]/g, '_') || 'shot';
    const baseFilename = `${safeShotId}_frame`;
    const filename = `${baseFilename}.jpg`;
    const fullPath = path.join(targetDir, filename);

    const isVertical = aspectRatio === '9:16';
    const width = isVertical ? 720 : 1280;
    const height = isVertical ? 1280 : 720;
    const sizeStr = isVertical ? '720*1280' : '1280*720';

    let degradedReason: string | undefined = options?.isMock
      ? '工程处于 Mock 预演模式，已跳过真实计费'
      : undefined;

    if (options?.abortSignal?.aborted) {
      throw new Error('渲染分镜图已被中断取消');
    }

    // 1. 尝试调用真实文生图模型
    const imageProvider = !options?.isMock ? MediaProviderFactory.getImageProvider() : null;
    if (imageProvider) {
      try {
        const generationPrompt = prompt || `电影分镜画面，机位 ${shotId}，高清影视光影，大师级构图`;
        const remoteUrl = await imageProvider.generateImage(generationPrompt, {
          size: sizeStr,
          abortSignal: options?.abortSignal,
        });

        if (remoteUrl) {
          const localPath = await MediaDownloader.getInstance().downloadToProject(
            projectId,
            remoteUrl,
            'keyframes',
            baseFilename
          );
          const resolved = MediaResolver.resolveDiskPath(localPath, projectId);
          if (resolved.isValid && fs.statSync(resolved.diskPath).size > 0) {
            return { url: localPath, isDegraded: false };
          }
        }
      } catch (err: any) {
        if (options?.abortSignal?.aborted || err?.name === 'AbortError') {
          throw err;
        }
        degradedReason = `真实关键帧生图模型调用未收敛: ${err.message || '未知异常'}`;
        console.warn(`[KeyframeRenderer] 真实模型生成关键帧图失败，执行本地降级 (标记 degraded):`, err);
      }
    } else if (!degradedReason) {
      degradedReason = '未配置可用文生图模型凭据 (IMAGE_API_KEY)';
    }

    if (options?.abortSignal?.aborted) {
      throw new Error('渲染分镜图已被中断取消');
    }

    // 2. 本地 FFmpeg 离线抽帧兜底
    try {
      const tempMp4 = fullPath.replace('.jpg', '.mp4');
      await this.ffmpeg.createTestClip({
        duration: 1,
        text: `Shot: ${shotId}`,
        outputPath: tempMp4,
        width,
        height,
        bgColor: '0x14141F',
      });
      await this.ffmpeg.extractFrame(tempMp4, 0, fullPath);
      if (fs.existsSync(tempMp4)) fs.unlinkSync(tempMp4);
    } catch {
      this.writeSolidColorImage(fullPath, width, height, '#14141F');
    }

    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size === 0) {
      this.writeSolidColorImage(fullPath, width, height, '#14141F');
    }

    return {
      url: MediaResolver.toMediaUrl(projectId, 'keyframes', filename),
      isDegraded: true,
      degradedReason,
    };
  }

  private static writeSolidColorImage(
    outputPath: string,
    width: number,
    height: number,
    bgColorHex: string
  ): void {
    const minimalJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
      0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
      0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
      0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
      0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
      0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
      0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
      0x00, 0xbf, 0x80, 0xff, 0xd9,
    ]);
    fs.writeFileSync(outputPath, minimalJpeg);
  }
}
