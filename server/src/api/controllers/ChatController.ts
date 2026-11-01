/**
 * api/controllers/ChatController.ts
 * AI 导演会话中枢与流式对话控制器 (Chat Controller SSOT)
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { SessionStore } from '../../chat/session/SessionStore.js';
import { DirectorAgent } from '../../agents/director/DirectorAgent.js';

export const chatController = new Hono();

// 创建新会话
chatController.post('/api/chat/:projectId/sessions', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const body = await c.req.json().catch(() => ({}));
    const title = body.title || '新创作会话';
    const initialStage = body.initialStage || 'narrative_design';

    const sessionStore = SessionStore.getInstance();
    const session = sessionStore.createSession(projectId, title, initialStage);

    return c.json({ success: true, session });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 获取项目的所有会话列表
chatController.get('/api/chat/:projectId/sessions', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const sessionStore = SessionStore.getInstance();
    const sessions = sessionStore.listSessions(projectId);
    return c.json({ success: true, sessions });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 获取指定会话详情
chatController.get('/api/chat/:projectId/sessions/:sessionId', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const sessionStore = SessionStore.getInstance();
    const session = sessionStore.getSession(projectId, sessionId);
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }
    return c.json({ success: true, session });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 获取会话的消息历史
chatController.get('/api/chat/:projectId/sessions/:sessionId/messages', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const sessionStore = SessionStore.getInstance();
    const messages = sessionStore.getMessages(projectId, sessionId);
    return c.json({ success: true, messages });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Director 流式对话推进 (SSE 原生真打字机)
chatController.post('/api/chat/:projectId/stream', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body.sessionId;
  const userContent = body.content || '';

  if (!sessionId) {
    return c.json({ success: false, error: '缺少 sessionId 参数' }, 400);
  }
  if (!userContent.trim()) {
    return c.json({ success: false, error: '发送内容不能为空' }, 400);
  }

  const director = DirectorAgent.getInstance();

  return streamSSE(c, async (stream) => {
    try {
      const { replyMessage, proposal } = await director.chatStream(
        projectId,
        sessionId,
        userContent,
        {
          onToken: async (token) => {
            await stream.writeSSE({
              event: 'token',
              data: JSON.stringify({ token }),
            });
          },
          onThought: async (thought) => {
            await stream.writeSSE({
              event: 'thought',
              data: JSON.stringify({ thought }),
            });
          },
          onProposal: async (actionProposal) => {
            await stream.writeSSE({
              event: 'proposal',
              data: JSON.stringify(actionProposal),
            });
          },
        },
        c.req.raw.signal
      );

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          message: replyMessage,
          proposal,
        }),
      });
    } catch (err: any) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: err.message || 'Director execution failed' }),
      });
    }
  });
});

// 🌟 显式提案生命周期流转：废弃/忽略提案 (Dismiss)
chatController.post('/api/chat/:projectId/proposals/:actionId/dismiss', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const actionId = c.req.param('actionId');
    const body = await c.req.json().catch(() => ({}));
    const sessionId = body.sessionId;

    if (!sessionId) {
      return c.json({ success: false, error: '缺少 sessionId' }, 400);
    }

    const sessionStore = SessionStore.getInstance();
    const messages = sessionStore.getMessages(projectId, sessionId);
    let found = false;

    for (const msg of messages) {
      if (msg.actionProposal && msg.actionProposal.actionId === actionId) {
        msg.actionProposal.status = 'dismissed';
        found = true;
        break;
      }
    }

    if (found) {
      sessionStore.saveMessages(projectId, sessionId, messages);
      return c.json({ success: true, message: `提案 [${actionId}] 已标记为废弃` });
    }
    return c.json({ success: false, error: `未找到提案 [${actionId}]` }, 404);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
