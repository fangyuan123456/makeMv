/**
 * api/routes/chat.route.ts
 * 中枢路由流式对话与意图提案路由 (Chat Domain Route)
 *
 * 核心设计：
 * 1. 单跳直出秒级流式打字：基于 SSE (Server-Sent Events) 输出 delta 字符；
 * 2. 伴随流式直出提案：对话结束时若触发 emit_router_intent，实时推送 action 卡片；
 * 3. 0 二次 LLM 消耗：聊天仅执行一次 RouterAgent 调用，绝不嵌套触发底层专业工种。
 */

import { Router } from 'express';
import { createRouterAgent } from '../../agents/router/router.agent.js';
import { sendError } from '../helpers.js';

export const chatRouter = Router();

chatRouter.post('/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string') {
    return sendError(res, 400, '请提供有效的对话内容 message');
  }

  // 1. 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (data: Record<string, any>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 2. 构造具备当前项目工程感知的 RouterAgent
    const agent = createRouterAgent(projectId);

    // 3. 组装对话历史
    const messages = [
      ...history.map((m: any) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    // 4. 启动流式响应
    const streamResult = await agent.stream(messages);

    // 5. 遍历文本打字流
    for await (const chunk of streamResult.textStream) {
      sendEvent({ type: 'text', delta: chunk });
    }

    // 6. 检查伴随触发的意图决策 Tool Call
    const toolCalls = await streamResult.toolCalls;
    if (toolCalls && toolCalls.length > 0) {
      for (const call of toolCalls) {
        if (call.toolName === 'emit_router_intent') {
          sendEvent({
            type: 'proposal',
            proposal: call.args,
          });
        }
      }
    }

    // 7. 发送完成信号
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: any) {
    sendEvent({ type: 'error', error: err.message || '总控对话推演异常' });
    res.end();
  }
});
