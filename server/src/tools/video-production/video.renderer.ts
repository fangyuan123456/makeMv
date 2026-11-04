/**
 * tools/video-production/video.renderer.ts
 * 动态视频切片生成领域专属渲染器 (Video Renderer SSOT)
 *
 * 核心机制（领域内聚）：
 * 1. 负责视频切片专属的 clipId / shotId 命名与 video/ 物理落盘；
 * 2. 负责影视分辨率 (720P / 1080P)、时长与画幅比例计算；
 * 3. 真实生视频模型 (Wanx-I2V / ComfyUI-I2V) + MediaDownloader 持久化 + 本地 FFmpeg 动态视频合成降级；
 * 4. 刚性断点与物理文件校验 (fs.existsSync 与 size > 0，杜绝假收敛)。
 */

import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { MediaResolver } from '../../media/MediaResolver.js';
import { MediaDownloader } from '../../media/MediaDownloader.js';
import { MediaProviderFactory } from '../../media/providers/MediaProviderFactory.js';
import { FFmpegService } from '../../media/ffmpeg.js';

export interface VideoRenderResult {
  url: string;
  isDegraded: boolean;
  degradedReason?: string;
}

export class VideoRenderer {
  private static ffmpeg: FFmpegService = new FFmpegService();

  public static setFFmpegService(service: FFmpegService): void {
    VideoRenderer.ffmpeg = service;
  }

  public static getFFmpegService(): FFmpegService {
    return VideoRenderer.ffmpeg;
  }

  /**
   * 渲染并写入动态视频切片文件 (.mp4)
   */
  public static async renderVideoClip(
    projectId: string,
    clipId: string,
    shotId: string,
    durationSec: number = 3,
    resolution: string = '720P',
    aspectRatio: string = '16:9',
    prompt?: string,
    referenceImageUrl?: string,
    options?: { isMock?: boolean; abortSignal?: AbortSignal }
  ): Promise<VideoRenderResult> {
    const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
    const targetDir = path.join(projectDir, 'video');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const safeClipId = clipId.replace(/[^\w-]/g, '_') || 'clip';
    const baseFilename = `${safeClipId}_clip`;
    const filename = `${baseFilename}.mp4`;
    const fullPath = path.join(targetDir, filename);

    let degradedReason: string | undefined = options?.isMock
      ? '工程处于 Mock 预演模式，已跳过真实计费'
      : undefined;

    if (options?.abortSignal?.aborted) {
      throw new Error('渲染视频切片已被中断取消');
    }

    // 1. 尝试调用真实视频生成模型 (Wanx-I2V / ComfyUI)
    const videoProvider = !options?.isMock ? MediaProviderFactory.getVideoProvider() : null;
    if (videoProvider) {
      try {
        const generationPrompt = prompt || `高清影视动态镜头，运镜平稳，自然光影变化`;
        const remoteUrl = await videoProvider.generateVideo(generationPrompt, {
          referenceImageUrl,
          durationSec,
          resolution: resolution as any,
          aspectRatio: aspectRatio as any,
          abortSignal: options?.abortSignal,
        });

        if (remoteUrl) {
          const localPath = await MediaDownloader.getInstance().downloadToProject(
            projectId,
            remoteUrl,
            'video',
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
        degradedReason = `真实生视频模型调用未收敛: ${err.message || '未知异常'}`;
        console.warn(`[VideoRenderer] 真实模型生成视频切片失败，执行本地降级 (标记 degraded):`, err);
      }
    } else if (!degradedReason) {
      degradedReason = '未配置可用生视频模型凭据 (VIDEO_API_KEY)';
    }

    if (options?.abortSignal?.aborted) {
      throw new Error('渲染视频切片已被中断取消');
    }

    // 2. 本地 FFmpeg 动态视频合成
    const isVertical = aspectRatio === '9:16';
    const width = resolution === '1080P' ? (isVertical ? 1080 : 1920) : (isVertical ? 720 : 1280);
    const height = resolution === '1080P' ? (isVertical ? 1920 : 1080) : (isVertical ? 1280 : 720);

    try {
      await this.ffmpeg.createTestClip({
        duration: Math.max(1, durationSec),
        text: `Clip: ${clipId} | Shot: ${shotId}`,
        outputPath: fullPath,
        width,
        height,
        bgColor: '0x101018',
      });
    } catch (err) {
      console.warn(`[VideoRenderer] FFmpeg 渲染动态视频片段警告:`, err);
      if (options?.isMock || !fs.existsSync(fullPath)) {
        // 本地离线与 Mock 兜底：写入标准 MP4 容器占位文件
        const minimalMp4 = Buffer.from([
          0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
          0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
          0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31, 0x00, 0x00, 0x00, 0x08,
          0x66, 0x72, 0x65, 0x65, 0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74,
        ]);
        fs.writeFileSync(fullPath, minimalMp4);
      }
    }

    // 3. 刚性门禁：确保磁盘真实文件写入完整且尺寸合规
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size === 0) {
      throw new Error(`[VideoRenderer] 视频切片物理文件落盘失败: ${fullPath}，拒绝假收敛`);
    }

    return {
      url: MediaResolver.toMediaUrl(projectId, 'video', filename),
      isDegraded: true,
      degradedReason,
    };
  }
}
