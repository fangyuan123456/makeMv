/**
 * api/routes/health.route.ts
 * 系统健康检查与服务探针路由
 */

import { Router } from 'express';
import { sendSuccess } from '../helpers.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  sendSuccess(res, {
    status: 'healthy',
    uptimeSec: Math.round(process.uptime()),
    nodeVersion: process.version,
  });
});
