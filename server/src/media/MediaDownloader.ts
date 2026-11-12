/**
 * media/MediaDownloader.ts
 * 媒体资产离线持久化下载器 (Media Downloader SSOT)
 *
 * 核心机制（法典 0.4 刚性阻断优于隐式苟且 & 法典 2.6 本地持久化与离线永久可用性）：
 * 1. 彻底消灭对第三方临时签名 URL (如阿里云 DashScope OSS 24小时有效链接) 的脆弱依赖；
 * 2. 异步流式安全下载至本地工程物理目录 data/projects/:projectId/:subfolder/；
 * 3. 统一转换为 /media/:projectId/:subfolder/:filename 的永久标准化本地路径；
 * 4. 内置超时与自动重试防御；
 * 5. 刚性 Fail-Fast：重试彻底失败时坚决抛出异常，彻底消灭 24 小时过期临时 URL 假收敛；
 * 6. 严密的文件名与路径穿越净化 (Path Traversal Guard)。
 */

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { MediaResolver } from './MediaResolver.js';

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
   * @param subfolder 子目录，如 'keyframes', 'video', 'audio', 'portraits', 'characters'
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

    // 非 http/https 协议（如 data:, blob: 等）直接返回原值
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return trimmed;
    }

    if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
      throw new Error('[MediaDownloader] projectId 必须为非空有效字符串');
    }

    const projectDir = ProjectStore.getInstance().getProjectDir(projectId);

    // 路径穿越与盘符逃逸防御：支持合法多级相对子目录（如 assets/entities、assets/scenes），刚性拦截 .. 与盘符逃逸
    const rawSegments = (subfolder || '')
      .replace(/^[a-zA-Z]:[/\\]?/, '')
      .split(/[/\\]+/)
      .filter(Boolean);
    if (rawSegments.some((s) => s === '..')) {
      throw new Error(`[MediaDownloader] 非法子目录路径穿越: "${subfolder}"`);
    }
    const cleanSegments = rawSegments
      .filter((s) => s !== '.')
      .map((s) => s.replace(/[^a-zA-Z0-9_\-]/g, '_'))
      .filter((s) => /[a-zA-Z0-9]/.test(s));
    const safeSubfolder = cleanSegments.length > 0 ? cleanSegments.join('/') : 'media';
    const targetDir = path.resolve(projectDir, ...safeSubfolder.split('/'));
    if (!targetDir.startsWith(path.resolve(projectDir) + path.sep)) {
      throw new Error(`[MediaDownloader] 非法子目录路径穿越: "${subfolder}"`);
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 探测扩展名 (从 URL 路径中推断，去除 Query 参数)
    let ext = '.png';
    try {
      const urlObj = new URL(trimmed);
      const parsedExt = path.extname(urlObj.pathname).toLowerCase();
      if (parsedExt && parsedExt.length <= 5) {
        ext = parsedExt;
      } else {
        if (safeSubfolder.includes('video')) ext = '.mp4';
        else if (safeSubfolder.includes('audio')) ext = '.mp3';
        else ext = '.png';
      }
    } catch {
      if (safeSubfolder.includes('video')) ext = '.mp4';
      else if (safeSubfolder.includes('audio')) ext = '.mp3';
      else ext = '.png';
    }

    // 路径穿越防御 (Path Traversal Guard - 文件名)：剥离一切目录层级并剔除非法字符
    let sanitizedCustom: string | undefined = undefined;
    if (customFilename) {
      let raw = customFilename;
      for (let i = 0; i < 3 && raw.includes('%'); i++) {
        try {
          raw = decodeURIComponent(raw);
        } catch {
          break;
        }
      }
      const cleaned = path
        .basename(raw)
        .replace(/[^a-zA-Z0-9_\-\.]/g, '_')
        .replace(/\.{2,}/g, '_')
        .replace(/\.+$/, '');
      if (cleaned && !/^[\._\-]+$/.test(cleaned)) {
        sanitizedCustom = cleaned;
      }
    }

    const baseName = sanitizedCustom || `media_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // 若 baseName 已自带合规扩展名，直接使用；否则追加探测出的 ext
    const existingExt = path.extname(baseName).toLowerCase();
    const validExts = [
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.mp4',
      '.mov',
      '.webm',
      '.mp3',
      '.wav',
      '.aac',
      '.m4a',
      '.svg',
    ];
    const filename = validExts.includes(existingExt)
      ? baseName
      : baseName.endsWith(ext)
      ? baseName
      : `${baseName}${ext}`;

    const destinationPath = path.resolve(targetDir, filename);
    if (!destinationPath.startsWith(targetDir + path.sep)) {
      throw new Error(`[MediaDownloader] 非法文件名路径穿越: "${customFilename}"`);
    }

    // 执行带超时的安全流式下载
    let attempts = 0;
    const maxAttempts = 2;
    let lastError: Error | null = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        timeout.unref?.();

        try {
          const response = await fetch(trimmed, { signal: controller.signal });

          if (!response.ok) {
            throw new Error(`下载远程媒体失败: HTTP ${response.status} ${response.statusText}`);
          }

          if (!response.body) {
            throw new Error('远程媒体响应体为空');
          }

          const nodeReadable = Readable.fromWeb(response.body as any);
          const fileStream = fs.createWriteStream(destinationPath);
          await pipeline(nodeReadable, fileStream, { signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }

        // 验证文件是否真实完整落盘 (法典 4.2 拒绝假收敛)
        if (fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 0) {
          return MediaResolver.toMediaUrl(projectId, safeSubfolder, filename);
        } else {
          if (fs.existsSync(destinationPath)) {
            try {
              fs.unlinkSync(destinationPath);
            } catch {}
          }
          throw new Error('下载文件为空或写入失败');
        }
      } catch (err: any) {
        lastError = err;
        if (fs.existsSync(destinationPath)) {
          try {
            fs.unlinkSync(destinationPath);
          } catch {}
        }
        console.warn(`[MediaDownloader] 下载尝试 ${attempts} 失败 (${trimmed}):`, err?.message || err);
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    console.error(`[MediaDownloader] 媒体下载重试彻底失败: ${trimmed}`, lastError);
    throw new Error(`[MediaDownloader] 媒体下载彻底失败 (${trimmed}): ${lastError?.message || '未知错误'}`);
  }

  public async downloadMedia(
    url: string,
    projectId: string,
    subfolder: string = 'media',
    customFilename?: string
  ): Promise<string> {
    return this.downloadToProject(projectId, url, subfolder, customFilename);
  }
}
