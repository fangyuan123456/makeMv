/**
 * media/MediaDownloader.ts
 * 媒体资产离线持久化下载器 (Media Downloader SSOT)
 *
 * 核心机制（法典 2.4 本地持久化与离线永久可用性）：
 * 1. 彻底消灭对第三方临时签名 URL (如阿里云 DashScope OSS 24小时有效链接) 的脆弱依赖；
 * 2. 异步流式安全下载至本地工程物理目录 data/projects/:projectId/:subfolder/；
 * 3. 统一转换为 /media/:projectId/:subfolder/:filename 的永久标准化本地路径；
 * 4. 内置超时与自动重试防御。
 */

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { config } from '../utils/config.js';

export class MediaDownloader {
  private static instance?: MediaDownloader;

  public static getInstance(): MediaDownloader {
    if (!MediaDownloader.instance) {
      MediaDownloader.instance = new MediaDownloader();
    }
    return MediaDownloader.instance;
  }

  /**
   * 将远程媒体 URL 下载落盘至项目本地物理目录，返回本地持久化访问路径
   * @param projectId 项目唯一标识
   * @param remoteUrl 远程带有签名的临时 URL (或已持久化的本地路径)
   * @param subfolder 子目录，如 'keyframes', 'videos', 'audio', 'portraits'
   * @param customFilename 可选的自定义文件名（不带扩展名则自动探测）
   * @returns 标准本地持久化路径，如 /media/:projectId/keyframes/keyframe_1.png
   */
  public async downloadToProject(
    projectId: string,
    remoteUrl: string,
    subfolder: string = 'media',
    customFilename?: string
  ): Promise<string> {
    if (!remoteUrl || typeof remoteUrl !== 'string') {
      return remoteUrl;
    }

    const trimmed = remoteUrl.trim();

    // 如果已经是本地 /media/ 路径或本地物理路径，直接返回
    if (trimmed.startsWith('/media/') || trimmed.startsWith('file://')) {
      return trimmed;
    }

    // 非 http/https 协议直接返回原值
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return trimmed;
    }

    const projectDir = path.join(config.paths.projects, projectId);
    const targetDir = path.join(projectDir, subfolder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 探测扩展名 (从 URL 路径中推断，去除 Query 参数)
    const urlObj = new URL(trimmed);
    let ext = path.extname(urlObj.pathname).toLowerCase();
    if (!ext || ext.length > 5) {
      // 常见兜底推断
      if (subfolder.includes('video')) ext = '.mp4';
      else if (subfolder.includes('audio')) ext = '.mp3';
      else ext = '.png';
    }

    const baseName = customFilename || `media_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const filename = baseName.endsWith(ext) ? baseName : `${baseName}${ext}`;
    const destinationPath = path.join(targetDir, filename);

    // 执行带超时的安全流式下载
    let attempts = 0;
    const maxAttempts = 2;
    let lastError: Error | null = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30秒超时

        const response = await fetch(trimmed, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`下载远程媒体失败: HTTP ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('远程媒体响应体为空');
        }

        const nodeReadable = Readable.fromWeb(response.body as any);
        const fileStream = fs.createWriteStream(destinationPath);
        await pipeline(nodeReadable, fileStream);

        // 验证文件是否真实完整落盘 (法典 4.2 拒绝假收敛)
        if (fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 0) {
          return `/media/${projectId}/${subfolder}/${filename}`;
        } else {
          throw new Error('下载文件为空或写入失败');
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[MediaDownloader] 下载尝试 ${attempts} 失败 (${trimmed}):`, err.message);
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    console.error(`[MediaDownloader] 媒体下载重试彻底失败: ${trimmed}`, lastError);
    // 若下载失败，保留原始 URL 以保证业务降级不崩溃
    return trimmed;
  }
}
