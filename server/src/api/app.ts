/**
 * api/app.ts
 * 纯服务端轻量 HTTP 网关总装出口 (Express Gateway SSOT)
 */

import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.route.js';
import { projectsRouter } from './routes/projects.route.js';
import { tasksRouter } from './routes/tasks.route.js';
import { workflowRouter } from './routes/workflow.route.js';
import { runtimeRouter } from './routes/runtime.route.js';
import { chatRouter } from './routes/chat.route.js';
import { mediaMiddleware } from './media.js';
import { sendError } from './helpers.js';

export function createApp(): express.Application {
  const app = express();

  // 1. 全局中间件
  app.use(cors());
  app.use(express.json());

  // 2. 静态媒体安全沙箱托管
  app.use(mediaMiddleware);

  // 3. 领域路由挂载
  app.use('/api/health', healthRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/workflow', workflowRouter);
  app.use('/api/runtime', runtimeRouter);
  app.use('/api/chat', chatRouter);

  // 3. 404 处理
  app.use((_req, res) => {
    sendError(res, 404, '接口不存在');
  });

  // 4. 全局未捕获异常中间件
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Gateway Error]:', err);
    sendError(res, 500, err?.message || '内部服务未知异常');
  });

  return app;
}
