/**
 * api/routes/tools.route.ts
 * 任务工具元数据与定义查询路由 (Tools Domain Route)
 */

import { Router } from 'express';
import { taskToolRegistry } from '../../task-engine/index.js';
import { sendSuccess } from '../helpers.js';

export const toolsRouter = Router();

/**
 * 获取当前已注册的全部任务工具元数据
 * GET /api/tools
 */
toolsRouter.get('/', (_req, res) => {
  const tools = taskToolRegistry.getAllTools();
  sendSuccess(res, tools, '获取任务工具列表成功');
});
