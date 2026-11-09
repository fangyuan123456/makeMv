/**
 * api/routes/workflow.route.ts
 * 生产流水线标准状态机控制路由 (Workflow Domain Route)
 *
 * 核心规范：
 * 告别零散的阶段私有接口，收敛为标准的三个工业级控制端点：
 * 1. POST /:projectId/start - 启动生产流水线 (进入阶段一并自动挂起)
 * 2. POST /:projectId/:runId/resume - 人在回路信号注入 (唤醒挂起并推进下一步)
 * 3. GET  /:projectId/:runId/state - 查询流水线状态快照与待审批资产
 */

import { Router } from 'express';
import { ProductionWorkflowEngine } from '../../workflows/production.workflow.js';
import { sendSuccess, sendError } from '../helpers.js';

export const workflowRouter = Router();

/**
 * 启动互动影游全生命周期生产流水线
 */
workflowRouter.post('/:projectId/start', async (req, res) => {
  const { userPrompt } = req.body;
  if (!userPrompt || typeof userPrompt !== 'string') {
    return sendError(res, 400, '请提供有效的策划创意 userPrompt');
  }

  try {
    const runId = await ProductionWorkflowEngine.start(req.params.projectId, userPrompt);
    sendSuccess(res, { runId, status: 'running' }, '影游生产流水线已成功启动');
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
});

/**
 * 人在回路信号注入：审批通过或驳回，驱动状态机内部推进
 */
workflowRouter.post('/:projectId/:runId/resume', async (req, res) => {
  const { approved = true, feedback } = req.body;

  try {
    const snapshot = await ProductionWorkflowEngine.resume(req.params.projectId, req.params.runId, {
      approved: Boolean(approved),
      feedback,
    });
    sendSuccess(res, snapshot, '审批信号已注入，状态机推进中');
  } catch (err: any) {
    sendError(res, 400, err.message);
  }
});

/**
 * 查询流水线状态快照与当前待审产物
 */
workflowRouter.get('/:projectId/:runId/state', async (req, res) => {
  try {
    const snapshot = ProductionWorkflowEngine.getState(req.params.projectId, req.params.runId);
    sendSuccess(res, snapshot);
  } catch (err: any) {
    sendError(res, 404, err.message);
  }
});
