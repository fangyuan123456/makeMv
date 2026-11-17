/**
 * api/routes/tasks.route.ts
 * 统一任务工具调度与生命周期监控路由 (Tasks Domain Route SSOT)
 */

import { Router } from 'express';
import { taskDispatcher, taskStore } from '../../task-engine/index.js';
import { sendSuccess, sendError } from '../helpers.js';

export const tasksRouter = Router();

/**
 * 派发执行指定的任务工具
 * POST /api/tasks/run
 * Body: { projectId: string, toolName: string, input: Record<string, any> }
 */
tasksRouter.post('/run', async (req, res) => {
  const { projectId, toolName, input, idempotencyKey } = req.body || {};

  if (!projectId || typeof projectId !== 'string') {
    return sendError(res, 400, '缺少有效参数: projectId (字符串)');
  }
  if (!toolName || typeof toolName !== 'string') {
    return sendError(res, 400, '缺少有效参数: toolName (字符串)');
  }

  try {
    const task = await taskDispatcher.dispatch({
      projectId,
      toolName,
      input: input || {},
      idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
    });
    sendSuccess(res, task, '任务已成功接收并进入后台执行');
  } catch (err: any) {
    sendError(res, 400, err?.message || '任务派发失败');
  }
});

/**
 * 获取指定任务详情
 * GET /api/tasks/:taskId
 */
tasksRouter.get('/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = taskStore.getTask(taskId);
  if (!task) {
    return sendError(res, 404, `未找到任务: ${taskId}`);
  }
  sendSuccess(res, task, '获取任务详情成功');
});

/**
 * 取消指定正在执行的任务
 * POST /api/tasks/:taskId/cancel
 */
tasksRouter.post('/:taskId/cancel', (req, res) => {
  const { taskId } = req.params;
  const ok = taskDispatcher.cancel(taskId);
  if (ok) {
    sendSuccess(res, { taskId, status: 'cancelled' }, '任务已成功取消');
  } else {
    sendError(res, 400, `无法取消任务 [${taskId}] (任务可能已完成或不存在)`);
  }
});

/**
 * 基于失败或取消任务重新发起一次执行
 * POST /api/tasks/:taskId/retry
 */
tasksRouter.post('/:taskId/retry', async (req, res) => {
  try {
    const task = await taskDispatcher.retry(req.params.taskId);
    sendSuccess(res, task, '任务已重新进入执行队列');
  } catch (err: any) {
    sendError(res, 400, err?.message || '任务重试失败');
  }
});

/**
 * 查询指定项目下的所有任务历史
 * GET /api/tasks/project/:projectId
 * 或者 GET /api/tasks?projectId=xxx
 */
tasksRouter.get('/project/:projectId', (req, res) => {
  const { projectId } = req.params;
  const list = taskStore.getTasksByProject(projectId);
  sendSuccess(res, list, '获取项目任务列表成功');
});

tasksRouter.get('/', (req, res) => {
  const projectId = req.query.projectId as string;
  if (!projectId) {
    return sendError(res, 400, '请提供 projectId 查询参数');
  }
  const list = taskStore.getTasksByProject(projectId);
  sendSuccess(res, list, '获取项目任务列表成功');
});
