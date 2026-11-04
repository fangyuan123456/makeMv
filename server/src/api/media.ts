/**
 * api/media.ts
 * 静态媒体切片托管服务 (委托 MediaResolver 安全沙箱与统一 MIME 门面)
 */

import fs from 'fs';
import type { ServerResponse } from 'http';
import { MediaResolver } from '../media/MediaResolver.js';
import { sendError } from './helpers.js';

export function handleMediaRequest(pathname: string, res: ServerResponse): boolean {
  if (!pathname.startsWith('/media/')) {
    return false;
  }

  const resolved = MediaResolver.resolveDiskPath(pathname);

  if (!resolved.projectId || !resolved.relativePath) {
    sendError(res, 400, '非法媒体请求路径');
    return true;
  }

  if (!resolved.isValid || !resolved.diskPath) {
    sendError(res, 404, '媒体文件不存在或禁止跨项目越权访问');
    return true;
  }

  const contentType = MediaResolver.getMimeType(resolved.diskPath);
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(resolved.diskPath).pipe(res);
  return true;
}
