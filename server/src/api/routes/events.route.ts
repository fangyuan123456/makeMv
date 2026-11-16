/**
 * api/routes/events.route.ts
 * 实时任务与系统事件 SSE 广播路由 (Events Domain Route SSOT)
 */

import { Router } from 'express';
import { taskStore, type TaskEventPayload } from '../../task-engine/index.js';

export const eventsRouter = Router();

/**
 * 建立 Server-Sent Events (SSE) 长连接
 * GET /api/events?projectId=xxx
 */
eventsRouter.get('/', (req, res) => {
  const targetProjectId = req.query.projectId as string | undefined;

  // 设置 SSE 标准响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // 发送初始连接成功事件
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

  // 心跳定时器，防止代理超时断开
  const heartbeatTimer = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 15000);

  // 监听任务状态事件
  const unsubscribe = taskStore.onTaskEvent((event: TaskEventPayload) => {
    if (!targetProjectId || event.projectId === targetProjectId) {
      res.write(`event: task_event\ndata: ${JSON.stringify(event)}\n\n`);
    }
  });

  // 客户端断开连接时清理
  req.on('close', () => {
    clearInterval(heartbeatTimer);
    unsubscribe();
  });
});
