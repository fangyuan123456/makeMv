/**
 * api/controllers/ChatController.ts
 * AI 导演会话中枢与流式对话控制器 (Chat Controller SSOT)
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ProjectStore, ProposalStore } from '../../project-store/index.js';
import { DirectorAgent } from '../../agents/director/DirectorAgent.js';
import { SessionStatus, WorkflowStage, type ProjectEntity } from '../../types/index.js';

export const chatController = new Hono();

// 创建新会话
chatController.post('/api/chat/:projectId/sessions', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const body = await c.req.json().catch(() => ({}));
    const title = body.title || '新创作会话';
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    const initialStage = body.initialStage || project?.currentStage || 'narrative_design';
    const session = store.createSession(projectId, title, initialStage);

    return c.json({ success: true, session });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 获取项目的所有会话列表
chatController.get('/api/chat/:projectId/sessions', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const store = ProjectStore.getInstance();
    const sessions = store.listSessions(projectId);
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
    const store = ProjectStore.getInstance();
    const session = store.getSession(projectId, sessionId);
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
    const store = ProjectStore.getInstance();
    const messages = store.getMessages(projectId, sessionId);
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

  const store = ProjectStore.getInstance();

  // 🌟 懒创建项目 (Lazy Project Bootstrap)：项目不存在时以首条消息为创意自动建项，免去显式 start 步骤
  if (!store.getProject(projectId)) {
    const content = userContent.trim();
    const now = new Date().toISOString();
    const lazyProject: ProjectEntity = {
      projectId,
      title: content.slice(0, 24) || '未命名互动影游',
      meta: {
        idea: content,
        style: '电影质感，高品质影视光影',
        videoRatio: '16:9',
        videoResolution: '720P',
        episodes: 1,
      },
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [
        {
          timestamp: now,
          stage: WorkflowStage.NARRATIVE_DESIGN,
          action: 'PROJECT_CREATED',
          details: 'Lazy-created from first chat message',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    store.saveProject(lazyProject);

    // 首条创意沉淀为备忘录白板 Logline (会话已由前端先行创建，缺省时静默跳过)
    try {
      const scratchpad = store.getScratchpad(projectId, sessionId);
      if (scratchpad && !scratchpad.logline) {
        store.updateScratchpad(projectId, sessionId, { logline: content });
      }
    } catch {
      /* 会话尚未创建时忽略 */
    }
  }

  // 🌟 懒创建会话 (Lazy Session Bootstrap)：会话未预先创建时自动按项目当前阶段一步到位创建，杜绝事后改名产生幽灵目录
  if (!store.getSession(projectId, sessionId)) {
    const project = store.getProject(projectId);
    const initialStage = project?.currentStage || 'narrative_design';
    store.createSession(projectId, '主线创作会话', initialStage, sessionId);
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

    // 🌟 原子更新独立提案存储实体 (ProposalStore SSOT)
    ProposalStore.getInstance().updateProposalStatus(projectId, actionId, 'dismissed');

    const store = ProjectStore.getInstance();
    const messages = store.getMessages(projectId, sessionId);
    let found = false;

    for (const msg of messages) {
      if (msg.actionProposal && msg.actionProposal.actionId === actionId) {
        msg.actionProposal.status = 'dismissed';
        found = true;
        break;
      }
    }

    if (found) {
      store.saveMessages(projectId, sessionId, messages);
      return c.json({ success: true, message: `提案 [${actionId}] 已标记为废弃` });
    }
    return c.json({ success: false, error: `未找到提案 [${actionId}]` }, 404);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
