/**
 * api/controllers/ReviewerController.ts
 * 独立影视审查官与剧本医生对辩质询控制器 (Reviewer Controller SSOT)
 */

import { Hono } from 'hono';
import { CriticReviewerAgent } from '../../agents/reviewer/CriticReviewerAgent.js';
import { SessionStore } from '../../chat/session/SessionStore.js';

export const reviewerController = new Hono();

// 获取当前最新有效的质检报告 (自动识别时效性与过期状态)
reviewerController.get('/api/chat/:projectId/reviewer/report', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const reviewer = CriticReviewerAgent.getInstance();
    const report = reviewer.getEffectiveReport(projectId);
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
    const report = await reviewer.review({
      projectId,
      targetStage: body.targetStage,
      userConstraints: body.userConstraints,
      userFeedback: body.userFeedback,
      abortSignal: c.req.raw.signal,
    });
    return c.json({ success: true, report });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 创作者与独立审查官对辩与质询接口
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
    const effectiveReport = reviewer.getEffectiveReport(projectId);
    const reply = await reviewer.chat({
      projectId,
      sessionId,
      userMessage: userMessage.trim(),
      targetStage: body.targetStage,
      currentReport: effectiveReport || undefined,
      abortSignal: c.req.raw.signal,
    });

    // 🌟 辩护成功联动解禁：若辩护获得审查官认可（门禁改判 PASS），自动解除会话白板上的假警报告诫
    if (sessionId && reply.reassessedGateStatus === 'PASS') {
      try {
        const sessionStore = SessionStore.getInstance();
        const session = sessionStore.getSession(projectId, sessionId);
        if (session && session.scratchpad.userConstraints) {
          session.scratchpad.userConstraints = session.scratchpad.userConstraints.filter(
            (c) => !c.startsWith('[审查官告诫]')
          );
          sessionStore.saveSession(session);
        }
      } catch (err) {
        console.warn('[ReviewerController] 解除白板告诫约束警告:', err);
      }
    }

    return c.json({ success: true, ...reply });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
