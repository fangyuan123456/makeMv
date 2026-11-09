/**
 * api/media.ts
 * 静态媒体切片托管服务 (委托 MediaResolver 安全沙箱与统一 MIME 门面)
 */

import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';
import { MediaResolver } from '../media/MediaResolver.js';
import { sendError } from './helpers.js';

export function mediaMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith('/media/')) {
    return next();
  }

  const resolved = MediaResolver.resolveDiskPath(req.path);

  if (!resolved.projectId || !resolved.relativePath) {
    sendError(res, 400, '非法媒体请求路径');
    return;
  }

  if (!resolved.isValid || !resolved.diskPath) {
    sendError(res, 404, '媒体文件不存在或禁止跨项目越权访问');
    return;
  }

  const contentType = MediaResolver.getMimeType(resolved.diskPath);
  res.setHeader('Content-Type', contentType);
  fs.createReadStream(resolved.diskPath).pipe(res);
}
