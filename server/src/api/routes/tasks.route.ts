/**
 * api/routes/tasks.route.ts
 * 异步任务生命周期与进度条监控路由 (Tasks Domain Route)
 */

import { Router } from 'express';
import { TaskStore } from '../../workflow-engine/TaskStore.js';
import { ConfirmationGate } from '../../workflow-engine/confirmation-gate.js';
import { ProductionWorkflowEngine } from '../../workflows/production.workflow.js';
import { sendSuccess, sendError } from '../helpers.js';

export const tasksRouter = Router();
const taskStore = TaskStore.getInstance();

/**
 * 查询指定项目下的所有任务状态与进度
 */
tasksRouter.get('/:projectId', (req, res) => {
  const tasks = taskStore.listTasks(req.params.projectId);
  res.json(tasks);
});

/**
 * 查询单个具体任务详情与进度
 */
tasksRouter.get('/:projectId/:taskId', (req, res) => {
  const task = taskStore.getTask(req.params.projectId, req.params.taskId);
  if (!task) {
    return sendError(res, 404, `未找到任务: ${req.params.taskId}`);
  }
  res.json(task);
});

/**
 * 创作者人在回路确认放行任务
 */
tasksRouter.post('/:projectId/:taskId/confirm', (req, res) => {
  try {
    const task = ConfirmationGate.confirmTask(req.params.projectId, req.params.taskId);
    sendSuccess(res, task, '任务已审批放行');
  } catch (err: any) {
    sendError(res, 400, err.message);
  }
});

/**
 * 创作者拒绝/取消任务
 */
tasksRouter.post('/:projectId/:taskId/reject', (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const reason = req.body?.reason || '创作者取消';
    const existing = taskStore.getTask(projectId, taskId);
    if (existing && (existing.status === 'running' || existing.status === 'queued')) {
      ProductionWorkflowEngine.cancel(projectId, taskId, reason);
      const cancelled = taskStore.getTask(projectId, taskId);
      sendSuccess(res, cancelled, '任务已中止取消');
      return;
    }
    const task = ConfirmationGate.rejectTask(projectId, taskId, reason);
    sendSuccess(res, task, '任务已取消');
  } catch (err: any) {
    sendError(res, 400, err.message);
  }
});
