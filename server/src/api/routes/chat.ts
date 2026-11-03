/**
 * api/routes/chat.ts
 * 自由对话交互、动态意图路由、SSE 打字机流式管道与双轨记忆落盘
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { ProjectStore } from '../../project-store/index.js';
import { DirectorRouter } from '../../mastra/router/index.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import { readJsonBody, sendJson, sendError } from '../helpers.js';

export async function handleChatRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  searchParams: URLSearchParams
): Promise<boolean> {
  if (pathname !== '/api/chat' || req.method !== 'POST') {
    return false;
  }

  const projectStore = ProjectStore.getInstance();
  const router = DirectorRouter.getInstance();

  try {
    const body = await readJsonBody(req);
    const { message, projectId, history } = body;
    const wantsStream = req.headers.accept === 'text/event-stream' || searchParams.get('stream') === 'true';

    let effectiveProjectId = projectId;
    if (!effectiveProjectId) {
      const list = projectStore.listProjects();
      if (list.length > 0) {
        effectiveProjectId = list[0].projectId;
      } else {
        const now = new Date().toISOString();
        effectiveProjectId = `proj_${Date.now()}`;
        projectStore.saveProject({
          projectId: effectiveProjectId,
          title: '全新互动影游项目',
          status: SessionStatus.IDLE,
          currentStage: WorkflowStage.NARRATIVE_DESIGN,
          stageArtifacts: {},
          history: [],
          meta: {
            idea: message || '',
            style: '电影质感，写实光影',
            videoRatio: '16:9',
            videoResolution: '720P' as const,
          },
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    console.log(`[HTTP API] 对话干预 -> 项目 [${effectiveProjectId}]: "${message}" (流式: ${wantsStream})`);

    // 调度 DirectorRouter 进行状态图分析与意图推演
    const routeResult = await router.routeMessage({
      projectId: effectiveProjectId,
      userMessage: message || '',
      history,
    });

    // 服务端双轨记忆持久化落盘 SSOT
    const project = projectStore.getProject(effectiveProjectId);
    if (project) {
      const now = new Date().toISOString();
      const currentHistory = Array.isArray(project.history) ? project.history : [];
      currentHistory.push({ role: 'user', content: message || '', timestamp: now } as any);
      currentHistory.push({
        role: 'assistant',
        content: routeResult.reply,
        timestamp: now,
        thought: routeResult.thought,
        proposal: routeResult.proposal,
      } as any);
      project.history = currentHistory;
      project.updatedAt = now;
      projectStore.saveProject(project);
    }

    if (wantsStream) {
      // SSE 流式打字机管道输出
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      res.write(`data: ${JSON.stringify({ type: 'thought', text: routeResult.thought })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'reply', text: routeResult.reply })}\n\n`);
      if (routeResult.proposal) {
        res.write(`data: ${JSON.stringify({ type: 'proposal', proposal: routeResult.proposal })}\n\n`);
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
      return true;
    }

    sendJson(res, 200, {
      success: true,
      projectId: effectiveProjectId,
      reply: routeResult.reply,
      thought: routeResult.thought,
      intent: routeResult.intent,
      proposal: routeResult.proposal,
    });
    return true;
  } catch (err: any) {
    console.error('[HTTP API] 对话调度异常:', err);
    sendError(res, 500, '对话调度异常，请稍后重试');
    return true;
  }
}
