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
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { sendSuccess, sendError } from '../helpers.js';

export const workflowRouter = Router();
const store = ProjectStore.getInstance();

/**
 * 启动互动影游全生命周期生产流水线
 */
workflowRouter.post('/:projectId/start', async (req, res) => {
  const { userPrompt, summary } = req.body;
  if (!userPrompt || typeof userPrompt !== 'string') {
    return sendError(res, 400, '请提供有效的策划创意 userPrompt');
  }

  try {
    const runId = await ProductionWorkflowEngine.start(
      req.params.projectId,
      userPrompt
    );
    store.markChatProposalsResolved(req.params.projectId);
    store.appendChatRecord(req.params.projectId, {
      role: 'user',
      content: `✅ 批准：${(typeof summary === 'string' && summary.trim()) || userPrompt}`,
    });
    store.appendChatRecord(req.params.projectId, {
      role: 'assistant',
      content: '收到，开始推演全案策划案。这一阶段的进度会在这条消息里实时更新。',
      taskRunId: runId,
      taskStage: 'plan_gdd',
    });
    sendSuccess(res, { runId, status: 'running' }, '影游生产流水线已成功启动');
  } catch (err: any) {
    const msg = String(err?.message || '');
    sendError(res, msg.includes('[409 Conflict]') ? 409 : 500, msg);
  }
});

/**
 * 人在回路信号注入：审批通过或驳回，驱动状态机内部推进
 */
workflowRouter.post('/:projectId/:runId/resume', async (req, res) => {
  const { approved = true, feedback, summary } = req.body;

  try {
    const prevState = ProductionWorkflowEngine.getState(req.params.projectId, req.params.runId);
    const prevPending = prevState.pendingApproval?.type;

    const snapshot = await ProductionWorkflowEngine.resume(req.params.projectId, req.params.runId, {
      approved: Boolean(approved),
      feedback,
    });

    if (Boolean(approved) && prevPending === 'gdd_approval') {
      store.markTaskNextProposalResolved(req.params.projectId, req.params.runId);
      store.appendChatRecord(req.params.projectId, {
        role: 'user',
        content: `✅ 批准：${(typeof summary === 'string' && summary.trim()) || '直接生成可玩的 index.html 互动文游'}`,
      });
      store.appendChatRecord(req.params.projectId, {
        role: 'assistant',
        content: '收到，直接装配可玩的 index.html 互动文游；角色定妆与关键帧不再单独确认。',
        taskRunId: req.params.runId,
        taskStage: 'build_text_game',
      });
    }

    sendSuccess(res, snapshot, '审批信号已注入，状态机推进中');
  } catch (err: any) {
    sendError(res, 400, err.message);
  }
});

/**
 * 主动取消正在执行或排队中的流水线
 */
workflowRouter.post('/:projectId/:runId/cancel', async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : '创作者主动取消任务';
    const snapshot = ProductionWorkflowEngine.cancel(
      req.params.projectId,
      req.params.runId,
      reason
    );
    sendSuccess(res, snapshot, '流水线任务已取消');
  } catch (err: any) {
    sendError(res, 404, err.message);
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
