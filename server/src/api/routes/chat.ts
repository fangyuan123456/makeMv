/**
 * api/routes/chat.ts
 * 基于 Mastra directorAgent 微内核的原生对话交互与抗碎片 SSE 打字机流式管道
 *
 * 核心机制（法典因果根治）：
 * 1. Agentic Loop 步数预算：统一注入 maxSteps: 5，保障多步工具调用后自然语言回复通道畅通；
 * 2. 纯净 User 输入：System 注入视听工程全景，User 仅传纯净 message，彻底根除上下文雪崩；
 * 3. Working Memory 真实闭环落盘：对话结束自动从 Memory 提取白板并写盘至 session.scratchpad；
 * 4. 抗 Token 碎片：使用 StreamTagParser 滑动窗口 100% 隔离 <think>...</think> 内部思维链；
 * 5. 快照比对：精准锁定本轮新增提案，杜绝旧卡重推。
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { ProjectStore, ProposalStore } from '../../project-store/index.js';
import { createDirectorAgent } from '../../agents/director/director.agent.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import { StreamTagParser } from '../../utils/StreamTagParser.js';
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
  const proposalStore = ProposalStore.getInstance();

  try {
    const body = await readJsonBody(req);
    const { message, projectId, sessionId } = body;
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

    // 确保会话白板管道畅通 (Session & Scratchpad SSOT)
    let effectiveSessionId = sessionId;
    if (!effectiveSessionId) {
      const existingSessions = projectStore.listSessions(effectiveProjectId);
      if (existingSessions.length > 0) {
        effectiveSessionId = existingSessions[0].sessionId;
      } else {
        const newSession = projectStore.createSession(effectiveProjectId, '默认创作会话');
        effectiveSessionId = newSession.sessionId;
      }
    }

    console.log(`[HTTP API] 对话干预 -> 项目 [${effectiveProjectId}][会话: ${effectiveSessionId}]: "${message}" (流式: ${wantsStream})`);

    // 记录用户消息至持久化历史
    const now = new Date().toISOString();
    const cleanUserText = (message || '').trim();
    const userMsg = { role: 'user', content: cleanUserText, timestamp: now };
    projectStore.appendMessage(effectiveProjectId, effectiveSessionId, userMsg as any);

    // 记录本次请求发起前的既有提案快照 (彻底消灭旧卡重复推送 Bug)
    const initialProposalIds = new Set(
      proposalStore.listProposals(effectiveProjectId).map((p) => p.actionId)
    );

    // 提取会话历史消息（按角色纯净提取最近 10 条交互轮次，真实注入智能体记忆上下文）
    const storedMessages = projectStore.getMessages(effectiveProjectId, effectiveSessionId) || [];
    const validTurnMessages = storedMessages
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
      .slice(-10)
      .map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.trim(),
      }));

    const agentDialogueInput = validTurnMessages.length > 0
      ? validTurnMessages
      : [{ role: 'user' as const, content: cleanUserText || '请根据当前项目进展提出导演专业建议' }];

    // 动态装配带有当前工程实时感知的总导演智能体
    const agent = createDirectorAgent(effectiveProjectId, effectiveSessionId);

    if (wantsStream) {
      // 开启原生 SSE 流式管道
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // 首帧立即回传项目与会话身份
      res.write(`data: ${JSON.stringify({ type: 'meta', projectId: effectiveProjectId, sessionId: effectiveSessionId })}\n\n`);

      const abortController = new AbortController();
      const onClose = () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      };
      req.on('close', onClose);
      res.on('close', onClose);

      let fullReply = '';
      let fullThought = '';
      const tagParser = new StreamTagParser();

      try {
        // 使用 Mastra 原生 stream 流式通道，真实多轮对话上下文输入，显式注入多步预算 maxSteps: 5
        const streamResult = await agent.stream(agentDialogueInput as any, {
          maxSteps: 5,
          memory: {
            thread: effectiveSessionId,
            resource: effectiveProjectId,
          },
          abortSignal: abortController.signal,
        });

        for await (const chunk of streamResult.textStream) {
          const { replyText, thoughtText } = tagParser.feed(chunk);

          if (thoughtText && !res.writableEnded) {
            fullThought += thoughtText;
            res.write(`data: ${JSON.stringify({ type: 'thought', thought: thoughtText })}\n\n`);
          }

          if (replyText && !res.writableEnded) {
            fullReply += replyText;
            res.write(`data: ${JSON.stringify({ type: 'chunk', content: replyText })}\n\n`);
          }
        }

        // 冲刷缓冲区尾部残余
        const flushed = tagParser.flush();
        if (flushed.thoughtText && !res.writableEnded) {
          fullThought += flushed.thoughtText;
          res.write(`data: ${JSON.stringify({ type: 'thought', thought: flushed.thoughtText })}\n\n`);
        }
        if (flushed.replyText && !res.writableEnded) {
          fullReply += flushed.replyText;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: flushed.replyText })}\n\n`);
        }

        // 检索本次对话是否产生了新的待审提案
        const currentPendingList = proposalStore.listProposals(effectiveProjectId, { status: 'pending' });
        const newProposal = currentPendingList.find((p) => !initialProposalIds.has(p.actionId));

        // 视听导演自愈守卫：若大模型仅执行了提案工具但未生成自然语言，主动补全导演引导文案，杜绝前端空白
        if (!fullReply.trim() && newProposal) {
          const autoReply = `收到您的创作构想！我已为您评估好【${newProposal.label}】实施方案，请查阅下方生成的行动卡片，确认授权后即可开启本阶段制作。`;
          fullReply = autoReply;
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', content: autoReply })}\n\n`);
          }
        }

        if (newProposal && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'proposal', proposal: newProposal })}\n\n`);
        }

        // 触发对话完成事件 (向前端打字机回传 fullText 与 finalProposal)
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'done', fullText: fullReply, finalProposal: newProposal })}\n\n`);
        }

        // 持久化落地助手回复
        const assistantMsg = {
          role: 'assistant',
          content: fullReply,
          thought: fullThought || undefined,
          timestamp: new Date().toISOString(),
          proposal: newProposal,
        };
        projectStore.appendMessage(effectiveProjectId, effectiveSessionId, assistantMsg as any);

        // ⚡ Working Memory 真实闭环持久化落盘
        const memory = await agent.getMemory();
        if (memory) {
          try {
            const wm = await (memory as any).getWorkingMemory({
              threadId: effectiveSessionId,
              resourceId: effectiveProjectId,
            });
            if (wm && typeof wm === 'object') {
              projectStore.updateScratchpad(effectiveProjectId, effectiveSessionId, wm);
            }
          } catch (wmErr) {
            console.warn('[chat] 同步 Working Memory 警告:', wmErr);
          }
        }
      } catch (streamErr: any) {
        console.error(`[HTTP API] SSE 流式生成异常:`, streamErr);
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: streamErr?.message || '生成中断' })}\n\n`);
        }
      } finally {
        req.off('close', onClose);
        res.off('close', onClose);
        if (!res.writableEnded) {
          res.write(`data: [DONE]\n\n`);
          res.end();
        }
      }

      return true;
    }

    // 非流式直调：真实多轮上下文输入 + maxSteps: 5
    const response = await agent.generate(agentDialogueInput as any, {
      maxSteps: 5,
      memory: {
        thread: effectiveSessionId,
        resource: effectiveProjectId,
      },
    });

    const parser = new StreamTagParser();
    const parsedChunk = parser.feed(response.text);
    const flushedChunk = parser.flush();
    const finalReply = parsedChunk.replyText + flushedChunk.replyText;
    const finalThought = parsedChunk.thoughtText + flushedChunk.thoughtText;

    // 检索本次对话是否产生了新的待审提案
    const currentPendingList = proposalStore.listProposals(effectiveProjectId, { status: 'pending' });
    const newProposal = currentPendingList.find((p) => !initialProposalIds.has(p.actionId));

    const assistantMsg = {
      role: 'assistant',
      content: finalReply || response.text,
      thought: finalThought || undefined,
      timestamp: new Date().toISOString(),
      proposal: newProposal,
    };
    projectStore.appendMessage(effectiveProjectId, effectiveSessionId, assistantMsg as any);

    // ⚡ Working Memory 真实闭环持久化落盘
    const memory = await agent.getMemory();
    if (memory) {
      try {
        const wm = await (memory as any).getWorkingMemory({
          threadId: effectiveSessionId,
          resourceId: effectiveProjectId,
        });
        if (wm && typeof wm === 'object') {
          projectStore.updateScratchpad(effectiveProjectId, effectiveSessionId, wm);
        }
      } catch (wmErr) {
        console.warn('[chat] 同步 Working Memory 警告:', wmErr);
      }
    }

    sendJson(res, 200, {
      success: true,
      projectId: effectiveProjectId,
      sessionId: effectiveSessionId,
      reply: finalReply || response.text,
      thought: finalThought || undefined,
      proposal: newProposal,
    });
    return true;
  } catch (err: any) {
    console.error('[HTTP API] 对话调度异常:', err);
    sendError(res, 500, '对话调度异常，请稍后重试');
    return true;
  }
}
