/**
 * server/src/api/routes/chat.route.ts
 * 导演 Agent 对话路由。
 *
 * 保持现有 HTTP/SSE 契约，委托 agents/runtime 执行对话与任务派发。
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { AgentFactory } from '../../agents/registry.js';
import { dispatchApprovedIntent, recoverPendingSummaries } from '../../agents/runtime/task-events.js';
import type { ChatImageAttachment } from '../../agents/runtime/types.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { MediaResolver } from '../../media/MediaResolver.js';
import { sendSuccess, sendError } from '../helpers.js';

export const chatRouter = Router();

const MAX_CHAT_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_CHAT_IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * 0. 聊天区图片上传落盘
 * POST /api/chat/uploads
 * Body: { projectId: string, dataUrl: string, filename?: string }
 */
chatRouter.post('/uploads', (req, res) => {
  try {
    const { projectId, dataUrl, filename } = req.body || {};
    if (!projectId || typeof projectId !== 'string') {
      return sendError(res, 400, '缺少有效参数: projectId');
    }
    if (!dataUrl || typeof dataUrl !== 'string') {
      return sendError(res, 400, '缺少有效参数: dataUrl');
    }

    const matches = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return sendError(res, 400, '图片格式无效，请上传 PNG/JPG/WebP 图片');
    }
    const mimeType = matches[1].toLowerCase();
    const ext = ALLOWED_CHAT_IMAGE_EXT[mimeType];
    if (!ext) {
      return sendError(res, 400, `暂不支持的图片类型: ${mimeType}`);
    }

    const buffer = Buffer.from(matches[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_CHAT_UPLOAD_BYTES) {
      return sendError(res, 400, '图片大小必须在 1B ~ 12MB 之间');
    }

    const store = ProjectStore.getInstance();
    const chatDir = path.join(store.getProjectDir(projectId), 'assets', 'chat');
    fs.mkdirSync(chatDir, { recursive: true });

    const safeFilename = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
    fs.writeFileSync(path.join(chatDir, safeFilename), buffer);

    const mediaUrl = MediaResolver.toMediaUrl(projectId, 'assets/chat', safeFilename);
    sendSuccess(
      res,
      {
        url: mediaUrl,
        name: typeof filename === 'string' && filename.trim() ? filename.trim() : safeFilename,
      },
      '聊天图片上传成功'
    );
  } catch (err: any) {
    sendError(res, 500, err?.message || '上传聊天图片失败');
  }
});

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
    const session = AgentFactory.create(sessionId, { projectId, sessionId });
    recoverPendingSummaries(session);
    const messages = session.getMessages();
    sendSuccess(res, messages, '获取会话历史成功');
  } catch (err: any) {
    sendError(res, 500, err?.message || '获取会话历史失败');
  }
});

chatRouter.post('/sessions/:sessionId/proposals/:proposalId/approve', async (req, res) => {
  const { projectId } = req.body || {};
  if (!projectId || typeof projectId !== 'string') {
    return sendError(res, 400, '缺少有效参数: projectId');
  }
  try {
    const session = AgentFactory.create(req.params.sessionId, { projectId, sessionId: req.params.sessionId });
    const result = session.approveProposal(req.params.proposalId);
    await dispatchApprovedIntent(session, result);
    sendSuccess(res, result, '提案已批准');
  } catch (err: any) {
    sendError(res, 409, err?.message || '批准提案失败');
  }
});

async function streamSessionHandler(req: any, res: any, targetSessionId: string) {
  const { projectId, message, focus, attachments } = req.body || {};

  if (!projectId || typeof projectId !== 'string') {
    return sendError(res, 400, '缺少有效参数: projectId (字符串)');
  }

  const validAttachments: ChatImageAttachment[] = Array.isArray(attachments)
    ? attachments
        .filter((item: any) => item && typeof item.url === 'string' && item.url.trim().length > 0)
        .slice(0, 4)
        .map((item: any) => ({
          url: item.url.trim(),
          ...(typeof item.name === 'string' && item.name.trim() ? { name: item.name.trim() } : {}),
        }))
    : [];

  const cleanMessage = typeof message === 'string' ? message.trim() : '';
  if (!cleanMessage && validAttachments.length === 0) {
    return sendError(res, 400, '缺少有效消息文本或图片附件');
  }
  const effectiveMessage = cleanMessage || '请查看我发送的图片，结合当前制片阶段给出你的专业观察与建议。';

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const abortController = new AbortController();
  let completed = false;
  res.on('close', () => {
    if (!completed && !res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const session = AgentFactory.create(targetSessionId, { projectId, sessionId: targetSessionId });

    await session.stream({
      message: effectiveMessage,
      attachments: validAttachments.length > 0 ? validAttachments : undefined,
      focus: focus && typeof focus === 'object' && typeof focus.location === 'string' ? focus : undefined,
      abortSignal: abortController.signal,
      onTextChunk: (chunk) => {
        if (abortController.signal.aborted || res.writableEnded) return;
        res.write(`data: ${JSON.stringify({ type: 'text', chunk })}\n\n`);
        res.flush?.();
      },
      onDone: async (result) => {
        if (abortController.signal.aborted || res.writableEnded) return;
        await dispatchApprovedIntent(session, result);
        if (abortController.signal.aborted || res.writableEnded) return;
        completed = true;
        res.write(
          `data: ${JSON.stringify({
            type: 'done',
            cleanText: result.cleanText,
            intent: result.intent,
            messageId: result.messageId,
            task: result.task,
            dispatchError: result.dispatchError,
          })}\n\n`
        );
        res.flush?.();
        res.end();
      },
      onError: (err) => {
        if (abortController.signal.aborted || res.writableEnded) return;
        completed = true;
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
    if (abortController.signal.aborted || err?.name === 'AbortError') return;
    console.error(`[AgentRoute Error: ${targetSessionId}]:`, err);
    if (!res.headersSent) {
      sendError(res, 500, err?.message || '流式服务启动失败');
    } else if (!res.writableEnded) {
      completed = true;
      res.write(`data: ${JSON.stringify({ type: 'error', error: err?.message || '流式服务启动失败' })}\n\n`);
      res.end();
    }
  }
}

/**
 * 4. 驱动指定会话的单跳直出流式推演
 * POST /api/chat/sessions/:sessionId/stream
 * Body: { projectId: string, message: string }
 */
chatRouter.post('/sessions/:sessionId/stream', async (req, res) => {
  await streamSessionHandler(req, res, req.params.sessionId);
});
