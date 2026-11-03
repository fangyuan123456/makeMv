/**
 * api/app.ts
 * 统一 HTTP 请求分发网关 (Request Dispatcher & Router Gateway)
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { handleCors, sendJson } from './helpers.js';
import { handleMediaRequest } from './media.js';
import { handleProjectRoutes } from './routes/projects.js';
import { handleChatRoute } from './routes/chat.js';
import { handleProposalRoutes } from './routes/proposals.js';

export async function dispatchHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 1. 跨域 OPTIONS 预检请求拦截
  if (handleCors(req, res)) {
    return;
  }

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 2. 健康检查端点
  if (pathname === '/health' || pathname === '/') {
    sendJson(res, 200, { status: 'ok', service: 'makemv-mastra-server' });
    return;
  }

  // 3. 静态媒体切片路由: /media/:projectId/...
  if (handleMediaRequest(pathname, res)) {
    return;
  }

  // 4. 对话与流式管道: POST /api/chat
  if (await handleChatRoute(req, res, pathname, parsedUrl.searchParams)) {
    return;
  }

  // 5. 提案流转与工作流恢复: /api/workflow/resume, /api/proposals/...
  if (await handleProposalRoutes(req, res, pathname)) {
    return;
  }

  // 6. 项目 CRUD 与拓扑状态图: /api/projects/...
  if (await handleProjectRoutes(req, res, pathname)) {
    return;
  }

  // 7. 未匹配路由兜底 404
  sendJson(res, 404, { error: 'Not Found' });
}
