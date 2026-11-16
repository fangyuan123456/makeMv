/**
 * api/app.ts
 * 纯服务端轻量 HTTP 网关总装出口 (Express Gateway SSOT)
 */

import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.route.js';
import { projectsRouter } from './routes/projects.route.js';
import { tasksRouter } from './routes/tasks.route.js';
import { toolsRouter } from './routes/tools.route.js';
import { eventsRouter } from './routes/events.route.js';
import { chatRouter } from './routes/chat.route.js';
import { mediaMiddleware } from './media.js';
import { sendError } from './helpers.js';

export function createApp(): express.Application {
  const app = express();

  // 1. 全局中间件
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 2. 静态媒体安全沙箱托管
  app.use(mediaMiddleware);

  // 3. 领域路由挂载 (专职分块智能体 + Tool-First 物理渲染架构)
  app.use('/api/health', healthRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/tools', toolsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/chat', chatRouter);

  // 4. 404 处理
  app.use((_req, res) => {
    sendError(res, 404, '接口不存在');
  });

  // 4. 全局未捕获异常中间件
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[API Gateway Error]:', err);
    if (res.headersSent) {
      return next(err);
    }
    const statusCode =
      typeof err?.statusCode === 'number'
        ? err.statusCode
        : typeof err?.status === 'number'
        ? err.status
        : 500;
    sendError(res, statusCode, err?.message || '内部服务未知异常');
  });

  return app;
}
