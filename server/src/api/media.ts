/**
 * api/media.ts
 * 静态媒体切片托管服务 (安全沙箱与防路径穿越防逃逸)
 */

import fs from 'fs';
import path from 'path';
import type { ServerResponse } from 'http';
import { ProjectStore } from '../project-store/index.js';
import { sendError } from './helpers.js';

export function handleMediaRequest(pathname: string, res: ServerResponse): boolean {
  if (!pathname.startsWith('/media/')) {
    return false;
  }

  const parts = pathname.replace('/media/', '').split('/');
  const projectId = parts[0];
  const relativeFilePath = parts.slice(1).join('/');

  if (!projectId || !relativeFilePath) {
    sendError(res, 400, '非法媒体请求路径');
    return true;
  }

  const projectStore = ProjectStore.getInstance();
  const projectDir = projectStore.getProjectDir(projectId);
  const safePath = path.resolve(projectDir, relativeFilePath);

  // 安全沙箱刚性防御：严格检查 relative 路径不能逃逸出 projectDir
  const relative = path.relative(projectDir, safePath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(safePath)) {
    sendError(res, 404, '媒体文件不存在或禁止跨项目越权访问');
    return true;
  }

  const ext = path.extname(safePath).toLowerCase();
  let contentType = 'application/octet-stream';
  if (ext === '.mp4') contentType = 'video/mp4';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
  else if (ext === '.json') contentType = 'application/json';

  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(safePath).pipe(res);
  return true;
}
