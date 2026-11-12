/**
 * api/routes/chat.route.ts
 * 中枢路由流式对话与断线续传路由 (Chat Domain Route)
 *
 * 核心设计：
 * 1. 单跳直出秒级流式打字：基于 SSE 输出 delta 字符，后台推演与 HTTP 连接解耦；
 * 2. 刷新断线续传：POST 发起后台生成流，GET /stream 支持断线重连补全 snapshot + 后续 delta；
 * 3. 伴随流式直出提案：对话结束时若触发 emit_router_intent，实时推送并落盘 action 卡片。
 */

import { Router } from 'express';
import { ChatStreamManager } from './chat-stream-manager.js';
import { sendError } from '../helpers.js';

export const chatRouter = Router();
const streamManager = ChatStreamManager.getInstance();

chatRouter.post('/:projectId', (req, res) => {
  const { projectId } = req.params;
  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string') {
    return sendError(res, 400, '请提供有效的对话内容 message');
  }

  try {
    streamManager.startStream({ projectId, message, history });
    streamManager.subscribe(projectId, req, res);
  } catch (err: any) {
    const status = String(err?.message || '').includes('409') ? 409 : 500;
    return sendError(res, status, err?.message || '总控对话推演异常');
  }
});

chatRouter.get('/:projectId/stream', (req, res) => {
  const { projectId } = req.params;
  streamManager.subscribe(projectId, req, res);
});
