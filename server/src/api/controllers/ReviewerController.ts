/**
 * api/controllers/ReviewerController.ts
 * 独立影视审查官与剧本医生对辩质询控制器 (Reviewer Controller SSOT)
 */

import { Hono } from 'hono';
import { CriticReviewerAgent } from '../../agents/reviewer/CriticReviewerAgent.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';

export const reviewerController = new Hono();

// 获取当前最新有效的质检报告 (支持按工序阶段隔离与失效检测)
reviewerController.get('/api/chat/:projectId/reviewer/report', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const stage = c.req.query('stage');
    const reviewer = CriticReviewerAgent.getInstance();
    const report = reviewer.getEffectiveReport(projectId, stage);
    if (!report) {
      return c.json({ success: false, error: '尚无质检报告' }, 404);
    }
    return c.json({ success: true, report });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 主动发起独立质检
reviewerController.post('/api/chat/:projectId/reviewer/review', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const body = await c.req.json().catch(() => ({}));
    const reviewer = CriticReviewerAgent.getInstance();
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    const resolvedConstraints =
      body.userConstraints ||
      (project?.meta as any)?.userConstraints ||
      store.listSessions(projectId).find((s) => s.scratchpad?.userConstraints?.length)?.scratchpad.userConstraints;

    const report = await reviewer.review({
      projectId,
      targetStage: body.targetStage,
      userConstraints: resolvedConstraints,
      userFeedback: body.userFeedback,
      abortSignal: c.req.raw.signal,
    });
    return c.json({ success: true, report });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 创作者与独立审查官对辩与质询接口 (对辩记录统一沉淀于 ReviewReport.debateLogs SSOT，绝不污染导演会话)
reviewerController.post('/api/chat/:projectId/reviewer/dialog', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const body = await c.req.json().catch(() => ({}));
    const userMessage = body.userMessage;
    const sessionId = body.sessionId;

    if (!userMessage || !userMessage.trim()) {
      return c.json({ success: false, error: '缺少质询或辩护内容 (userMessage)' }, 400);
    }

    const reviewer = CriticReviewerAgent.getInstance();
    const effectiveReport = reviewer.getEffectiveReport(projectId, body.targetStage);
    const reply = await reviewer.chat({
      projectId,
      sessionId,
      userMessage: userMessage.trim(),
      targetStage: body.targetStage,
      currentReport: effectiveReport || undefined,
      abortSignal: c.req.raw.signal,
    });

    return c.json({ success: true, ...reply });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
