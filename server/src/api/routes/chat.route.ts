/**
 * server/src/api/routes/chat.route.ts
 * 通用对话会话路由 (Chat Session Route SSOT)
 *
 * 全面基于 BaseChatSession 及其派生子类驱动，彻底消灭特定业务孤岛。
 */

import { Router } from 'express';
import { ChatSessionFactory } from '../../chat/index.js';
import { sendSuccess, sendError } from '../helpers.js';

export const chatRouter = Router();

/**
 * 1. 查询指定会话全部历史对白
 * GET /api/chat/sessions/:sessionId?projectId=...
 */
chatRouter.get('/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return sendError(res, 400, '缺少有效参数: projectId (字符串)');
  }

  try {
    const session = ChatSessionFactory.create(sessionId, { projectId, sessionId });
    const messages = session.getMessages();
    sendSuccess(res, messages, '获取会话历史成功');
  } catch (err: any) {
    sendError(res, 500, err?.message || '获取会话历史失败');
  }
});

/**
 * 2. 向指定会话写入消息并落盘（支持提案仲裁）
 * POST /api/chat/sessions/:sessionId/messages
 * Body: { projectId: string, message: any, resolveProposals?: boolean }
 */
chatRouter.post('/sessions/:sessionId/messages', (req, res) => {
  const { sessionId } = req.params;
  const { projectId, message, resolveProposals } = req.body || {};

  if (!projectId || typeof projectId !== 'string') {
    return sendError(res, 400, '缺少有效参数: projectId (字符串)');
  }
  if (!message || typeof message !== 'object') {
    return sendError(res, 400, '缺少有效参数: message (对象)');
  }

  try {
    const session = ChatSessionFactory.create(sessionId, { projectId, sessionId });
    session.appendMessage(message, Boolean(resolveProposals));
    sendSuccess(res, session.getMessages(), '消息落盘成功');
  } catch (err: any) {
    sendError(res, 500, err?.message || '消息落盘失败');
  }
});

/**
 * 2.1 原地更新会话中某条消息（如任务状态、进度与终态成果摘要）
 * PATCH /api/chat/sessions/:sessionId/messages/:messageId
 * Body: { projectId: string, patch: any }
 */
chatRouter.patch('/sessions/:sessionId/messages/:messageId', (req, res) => {
  const { sessionId, messageId } = req.params;
  const { projectId, patch } = req.body || {};

  if (!projectId || typeof projectId !== 'string') {
    return sendError(res, 400, '缺少有效参数: projectId (字符串)');
  }
  if (!patch || typeof patch !== 'object') {
    return sendError(res, 400, '缺少有效参数: patch (对象)');
  }

  try {
    const session = ChatSessionFactory.create(sessionId, { projectId, sessionId });
    session.updateMessage(messageId, patch);
    sendSuccess(res, session.getMessages(), '消息更新成功');
  } catch (err: any) {
    sendError(res, 500, err?.message || '消息更新失败');
  }
});

/**
 * 3. 标记指定会话内所有未决提案为已解决
 * POST /api/chat/sessions/:sessionId/resolve
 * Body: { projectId: string }
 */
chatRouter.post('/sessions/:sessionId/resolve', (req, res) => {
  const { sessionId } = req.params;
  const { projectId } = req.body || {};

  if (!projectId || typeof projectId !== 'string') {
    return sendError(res, 400, '缺少有效参数: projectId (字符串)');
  }

  try {
    const session = ChatSessionFactory.create(sessionId, { projectId, sessionId });
    session.markProposalsResolved();
    sendSuccess(res, session.getMessages(), '提案裁决成功');
  } catch (err: any) {
    sendError(res, 500, err?.message || '提案裁决失败');
  }
});

async function streamSessionHandler(req: any, res: any, targetSessionId: string) {
  const { projectId, message, history, isSystemTrigger, targetMessageId } = req.body || {};

  if (!projectId || typeof projectId !== 'string') {
    return sendError(res, 400, '缺少有效参数: projectId (字符串)');
  }
  if (!message || typeof message !== 'string') {
    return sendError(res, 400, '缺少有效参数: message (字符串)');
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const session = ChatSessionFactory.create(targetSessionId, { projectId, sessionId: targetSessionId });

    await session.stream({
      message,
      history,
      isSystemTrigger: Boolean(isSystemTrigger),
      targetMessageId: targetMessageId ? String(targetMessageId) : undefined,
      onTextChunk: (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'text', chunk })}\n\n`);
      },
      onDone: (result) => {
        res.write(
          `data: ${JSON.stringify({
            type: 'done',
            cleanText: result.cleanText,
            intent: result.intent,
            messageId: result.messageId,
          })}\n\n`
        );
        res.end();
      },
      onError: (err) => {
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            error: err?.message || '会话流式推演异常',
          })}\n\n`
        );
        res.end();
      },
    });
  } catch (err: any) {
    console.error(`[ChatSessionRoute Error: ${targetSessionId}]:`, err);
    if (!res.headersSent) {
      sendError(res, 500, err?.message || '流式服务启动失败');
    }
  }
}

/**
 * 4. 驱动指定会话的单跳直出流式推演
 * POST /api/chat/sessions/:sessionId/stream
 * Body: { projectId: string, message: string, history?: any[], isSystemTrigger?: boolean }
 */
chatRouter.post('/sessions/:sessionId/stream', async (req, res) => {
  await streamSessionHandler(req, res, req.params.sessionId);
});

/**
 * 5. 向下兼容旧版工序 1 别名路由（内部 100% 委托给 PlannerChatSession 实例）
 */
chatRouter.post('/planner', async (req, res) => {
  await streamSessionHandler(req, res, 'planner');
});

chatRouter.get('/planner/history', (req, res) => {
  const { projectId } = req.query;
  if (!projectId || typeof projectId !== 'string') {
    return sendError(res, 400, '缺少有效参数: projectId (字符串)');
  }
  try {
    const session = ChatSessionFactory.create('planner', { projectId, sessionId: 'planner' });
    sendSuccess(res, session.getMessages(), '获取会话历史成功');
  } catch (err: any) {
    sendError(res, 500, err?.message || '获取会话历史失败');
  }
});
