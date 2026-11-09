/**
 * api/routes/projects.route.ts
 * 项目工程管理与资产查询路由 (Projects Domain Route)
 */

import { Router } from 'express';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { sendSuccess, sendError } from '../helpers.js';

export const projectsRouter = Router();
const store = ProjectStore.getInstance();

/**
 * 列出所有项目元数据
 */
projectsRouter.get('/', (_req, res) => {
  const list = store.listProjects();
  res.json(list);
});

/**
 * 获取指定项目的完整工程详情与资产
 */
projectsRouter.get('/:id', (req, res) => {
  try {
    const proj = store.getProject(req.params.id);
    res.json(proj);
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
});
