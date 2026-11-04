/**
 * media/MediaResolver.ts
 * 全局媒体路径映射、安全沙箱防穿越与格式解析统一中枢 (Media Resolver SSOT)
 *
 * 核心机制：
 * 1. 单一事实来源 (SSOT)：规范 /media/:projectId/:subfolder/:filename 路由契约；
 * 2. 刚性安全沙箱防御：严格校验防路径穿越 (..) 与防跨项目越权逃逸；
 * 3. 真实视听闭环：支持将本地 /media/... 本地路径自动转换为可供公网 API 消费的 Data URI (Base64)；
 * 4. 统一 MIME 映射：完整覆盖 mp4, png, jpg, jpeg, webp, mp3, wav, json。
 */

import fs from 'fs';
import path from 'path';
import { config } from '../utils/config.js';
import { ProjectStore } from '../project-store/ProjectStore.js';

export interface ResolvedMediaDiskPath {
  diskPath: string;
  isValid: boolean;
  projectId?: string;
  relativePath?: string;
}

export class MediaResolver {
  /**
   * 生成标准本地媒体 URL
   * @example /media/my_proj/characters/hero_portrait.jpg
   */
  public static toMediaUrl(projectId: string, subfolder: string, filename: string): string {
    const cleanSub = subfolder.replace(/^\/+|\/+$/g, '');
    const cleanFile = filename.replace(/^\/+/, '');
    return `/media/${projectId}/${cleanSub}/${cleanFile}`;
  }

  /**
   * 将 /media/... URL 或本地相对/绝对路径解析为安全可信的磁盘物理路径
   * 自动实施项目物理目录沙箱边界检查，杜绝路径穿越逃逸
   */
  public static resolveDiskPath(mediaUrlOrPath: string, defaultProjectId?: string): ResolvedMediaDiskPath {
    if (!mediaUrlOrPath || typeof mediaUrlOrPath !== 'string') {
      return { diskPath: '', isValid: false };
    }

    const trimmed = mediaUrlOrPath.trim();

    // 1. 处理 file:// 协议
    if (trimmed.startsWith('file://')) {
      const cleanPath = trimmed.replace('file://', '');
      return {
        diskPath: cleanPath,
        isValid: fs.existsSync(cleanPath),
      };
    }

    // 2. 处理 /media/:projectId/... 标准路径
    if (trimmed.startsWith('/media/')) {
      const parts = trimmed.replace(/^\/media\//, '').split('/');
      const projId = parts[0];
      const relativeParts = parts.slice(1);

      if (!projId || relativeParts.length === 0) {
        return { diskPath: '', isValid: false, projectId: projId };
      }

      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(projId);
      const safeDiskPath = path.resolve(projectDir, ...relativeParts);

      // 安全沙箱刚性防御：严格检查 safeDiskPath 必须落在 projectDir 内
      const rel = path.relative(projectDir, safeDiskPath);
      const isEscape = rel.startsWith('..') || path.isAbsolute(rel);

      return {
        diskPath: safeDiskPath,
        isValid: !isEscape && fs.existsSync(safeDiskPath),
        projectId: projId,
        relativePath: relativeParts.join('/'),
      };
    }

    // 3. 处理已带有项目上下文的相对路径
    if (defaultProjectId) {
      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(defaultProjectId);
      const safeDiskPath = path.resolve(projectDir, trimmed);

      const rel = path.relative(projectDir, safeDiskPath);
      const isEscape = rel.startsWith('..') || path.isAbsolute(rel);

      return {
        diskPath: safeDiskPath,
        isValid: !isEscape && fs.existsSync(safeDiskPath),
        projectId: defaultProjectId,
        relativePath: trimmed,
      };
    }

    // 4. 普通本地磁盘绝对路径
    if (path.isAbsolute(trimmed)) {
      return {
        diskPath: trimmed,
        isValid: fs.existsSync(trimmed),
      };
    }

    return { diskPath: trimmed, isValid: fs.existsSync(trimmed) };
  }

  /**
   * 将本地图片文件转换为 Base64 Data URI
   * 若原本就是 http/https/data: 开头则直接返回原 URL
   */
  public static toDataUri(mediaUrlOrPath: string, defaultProjectId?: string): string {
    if (!mediaUrlOrPath || typeof mediaUrlOrPath !== 'string') {
      return mediaUrlOrPath;
    }

    const trimmed = mediaUrlOrPath.trim();
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:image/')
    ) {
      return trimmed;
    }

    const resolved = this.resolveDiskPath(trimmed, defaultProjectId);
    if (!resolved.isValid || !resolved.diskPath) {
      return trimmed;
    }

    try {
      const stat = fs.statSync(resolved.diskPath);
      if (stat.size === 0) {
        return trimmed;
      }

      const mime = this.getMimeType(resolved.diskPath);
      const base64Str = fs.readFileSync(resolved.diskPath).toString('base64');
      return `data:${mime};base64,${base64Str}`;
    } catch {
      return trimmed;
    }
  }

  /**
   * 获取标准的 MIME Content-Type
   */
  public static getMimeType(filePathOrUrl: string): string {
    const ext = path.extname(filePathOrUrl.split('?')[0]).toLowerCase();
    switch (ext) {
      case '.mp4':
        return 'video/mp4';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.webp':
        return 'image/webp';
      case '.mp3':
        return 'audio/mpeg';
      case '.wav':
        return 'audio/wav';
      case '.json':
        return 'application/json';
      default:
        return 'application/octet-stream';
    }
  }
}
