/**
 * api/routes/chat.ts
 * 基于 Mastra directorAgent 微内核的原生对话交互与抗碎片 SSE 打字机流式管道
 *
 * 核心机制（法典因果根治）：
 * 1. 纯认知秒级直出：总导演 0 业务伪工具套娃，单跳流式秒级打字，消除两连跳与虚假 maxSteps 预算；
 * 2. 纯净多轮输入：System 注入视听工程全景，对话轮次纯净传递，严格遵守 user/assistant 角色交替；
 * 3. Turns 角色交替防破损：流式中断或早报崩溃自动补录占位 assistant 消息，保障历史完整无缝；
 * 4. 意图单向位序门禁：严格按工序顺序流转推进，阻断跳序越级；
 * 5. 快照比对：精准锁定本轮新增提案，杜绝旧卡重推。
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { ProjectStore, ProposalStore } from '../../project-store/index.js';
import { createDirectorAgent, ChatMemoryManager, extractDirectorIntent, type AgentIntentSignal } from '../../agents/director/index.js';
import { resolveTargetToSkill } from '../../agents/director/modifier/index.js';
import { WorkflowStage, SessionStatus, STAGE_SEQUENCE, type ActionProposal } from '../../types/index.js';
import { Workflow } from '../../workflow-engine/index.js';
import { STAGE_TRANSITION_MAP, SKILL_OF_STAGE, STAGE_OF_SKILL } from '../../agents/director/generator/constants.js';
import { readJsonBody, sendJson, sendError } from '../helpers.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * 模块 A：意图向行动提案解析器 (Intent ➔ ActionProposal SSOT)
 * 职责：纯业务领域逻辑。接收大模型 Tool Call 意图信号，结合项目黑板状态与门禁，
 *       生成生命周期为 pending 或 running 的合法强类型提案。
 * ══════════════════════════════════════════════════════════════════════════════ */

async function resolveIntentToProposal(
  projectId: string,
  sessionId: string,
  intent: AgentIntentSignal,
  userMessage: string
): Promise<ActionProposal | undefined> {
  const projectStore = ProjectStore.getInstance();
  const project = projectStore.getProject(projectId);
  if (!project) return undefined;

  const currentStage = project.currentStage;

  // 1. 刚性终局拦截：若影游工程已处于完结状态 (COMPLETED)，全链路已封装完毕，禁止产生任何新提案
  if (currentStage === WorkflowStage.COMPLETED) {
    console.log(`[chat] 项目 [${projectId}] 互动影游母带已全部制作打包完结 (COMPLETED)，拦截后续任何提案`);
    return undefined;
  }

  // 2. 审查门禁 FAIL 阻断守则（法典 2.5）：若当前阶段审计门禁处于 FAIL，坚决拦截推进类提案向后带病推进
  const reviewArtifact =
    projectStore.getArtifact<any>(projectId, `critic_review_${currentStage}`) ||
    projectStore.getArtifact<any>(projectId, 'criticReports') ||
    projectStore.getArtifact<any>(projectId, 'critic_review');
  const gateStatus = reviewArtifact?.gateStatus || reviewArtifact?.gateDecision;
  if (intent.action === 'next' && gateStatus === 'FAIL') {
    console.warn(`[chat] 拦截带病推进请求: 当前阶段 [${currentStage}] 审查门禁处于 [FAIL]，禁止生成推进提案`);
    return undefined;
  }

  // 3. 刚性防重放守卫：若当前已有工序处于 running 执行中，复用该提案，拦截大模型重复发放新推进卡片
  const proposalStore = ProposalStore.getInstance();
  const existingRunning = proposalStore.listProposals(projectId, { status: 'running' });
  if (existingRunning.length > 0 && intent.action === 'next') {
    console.log(`[chat] 检测到当前已有工序 [${existingRunning[0].skill}] 处于 running 执行中，复用该提案，拦截重复派发`);
    return existingRunning[0];
  }

  const engine = Workflow.getInstance();

  // 4. 根据不同的意图动作进行工序校验与工作流分发
  switch (intent.action) {
    case 'next': {
      let targetSkill = intent.skill;
      const currentArtifact = projectStore.getArtifact(projectId, currentStage);
      const defaultNextStage = STAGE_TRANSITION_MAP[SKILL_OF_STAGE[currentStage] || ''] || currentStage;
      const standardNextSkill = currentArtifact
        ? (SKILL_OF_STAGE[defaultNextStage] || SKILL_OF_STAGE[currentStage])
        : (SKILL_OF_STAGE[currentStage] || 'story-bible');

      if (!targetSkill) {
        targetSkill = standardNextSkill;
      } else {
        // 刚性防越级门禁校验：未落盘时只能是当前工序；已就绪允许进入下一阶段
        const targetStage = STAGE_OF_SKILL[targetSkill];
        const currentStageIndex = STAGE_SEQUENCE.indexOf(currentStage as WorkflowStage);
        const targetStageIndex = targetStage ? STAGE_SEQUENCE.indexOf(targetStage) : -1;
        const maxAllowedStageIndex = currentArtifact ? currentStageIndex + 1 : currentStageIndex;

        if (targetStageIndex === -1 || targetStageIndex > maxAllowedStageIndex) {
          console.warn(
            `[chat] 拦截越级或非法推进工序请求: ${targetSkill} (当前阶段: ${currentStage}, 资产就绪: ${!!currentArtifact})，自动收敛为合法工序: ${standardNextSkill}`
          );
          targetSkill = standardNextSkill;
        }
      }

      if (targetSkill) {
        const dispatchRes = await engine.dispatch({
          projectId,
          sessionId,
          workflowKey: targetSkill,
          actionType: 'PROCEED_STAGE',
          reason: `推进工序至 [${targetSkill}] 阶段`,
          userPrompt: userMessage,
          requireConfirmation: true, // 对话中提议推进，100% 生成 pending 待审卡片
        });
        return dispatchRes.proposal;
      }
      return undefined;
    }

    case 'approve': {
      // 创作者打字同意/开启：激活启动当前待审提案
      const currentPendingList = proposalStore.listProposals(projectId, { status: 'pending' });
      if (currentPendingList.length > 0) {
        const targetProposal = currentPendingList[currentPendingList.length - 1];
        console.log(`[Director Intent] AI 识别创作者打字批准意图 -> 启动提案 [${targetProposal.actionId}] (${targetProposal.label})`);
        const startResult = await engine.startProposal({
          projectId,
          proposalId: targetProposal.actionId,
        });
        return startResult.proposal;
      }

      const targetSkill = SKILL_OF_STAGE[currentStage] || 'story-bible';
      const dispatchRes = await engine.dispatch({
        projectId,
        sessionId,
        workflowKey: targetSkill,
        actionType: 'PROCEED_STAGE',
        reason: userMessage || '创作者打字确认进入下一工序',
        userPrompt: userMessage,
        requireConfirmation: false,
      });
      return dispatchRes.proposal;
    }

    case 'modify': {
      // 定向微调工序已有资产
      const targetSkill = resolveTargetToSkill(
        projectId,
        intent.target || undefined,
        currentStage,
        intent.skill || undefined
      );
      const userInstruction = intent.content || userMessage;
      const dispatchRes = await engine.dispatch({
        projectId,
        sessionId,
        workflowKey: targetSkill,
        actionType: 'TARGETED_REVISE',
        reason: userInstruction || `定向微调工序 [${targetSkill}] 资产`,
        userPrompt: userInstruction,
        parameters: {
          target: intent.target,
          userFeedback: userInstruction,
        },
      });
      return dispatchRes.proposal;
    }

    case 'audit': {
      const dispatchRes = await engine.dispatch({
        projectId,
        sessionId,
        workflowKey: 'critic-review',
        actionType: 'CRITIC_AUDIT',
        reason: intent.content || userMessage || '独立审查官多维质检评估',
        userPrompt: userMessage,
        requireConfirmation: true,
      });
      return dispatchRes.proposal;
    }

    case 'rollback': {
      const targetSkill = intent.skill || SKILL_OF_STAGE[currentStage] || 'story-bible';
      const dispatchRes = await engine.dispatch({
        projectId,
        sessionId,
        workflowKey: targetSkill,
        actionType: 'STAGE_ROLLBACK',
        reason: intent.content || userMessage || '时空回退重新推演',
        userPrompt: userMessage,
        requireConfirmation: true,
      });
      return dispatchRes.proposal;
    }

    default:
      return undefined;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 模块 B：SSE 流式网络管道驱动 (SSE Stream Pipeline)
 * 职责：纯网络协议封装。管理 SSE 头部、打字机 chunk 缓冲推送、思维链与提案分发
 * ══════════════════════════════════════════════════════════════════════════════ */

interface SsePipelineParams {
  req: IncomingMessage;
  res: ServerResponse;
  agent: any;
  agentDialogueInput: Array<{ role: string; content: string }>;
  projectId: string;
  sessionId: string;
  cleanUserText: string;
  initialProposalIds: Set<string>;
  justApprovedProposal?: ActionProposal;
  approvedProposalId?: string;
}

async function runSseStreamPipeline(params: SsePipelineParams): Promise<void> {
  const {
    req,
    res,
    agent,
    agentDialogueInput,
    projectId,
    sessionId,
    cleanUserText,
    initialProposalIds,
    justApprovedProposal,
    approvedProposalId,
  } = params;

  const projectStore = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const memoryManager = ChatMemoryManager.getInstance();

  // 1. 初始化 SSE 管道连接与抗缓冲头部
  req.socket?.setNoDelay(true);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 2. 首帧推送项目与会话元数据
  res.write(`data: ${JSON.stringify({ type: 'meta', projectId, sessionId })}\n\n`);
  (res as any).flush?.();

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

  try {
    // 3. 启动 Mastra Agent 原生全事件流通道 (fullStream SSOT, 强制 toolChoice: 'required' 必出决策工具调用)
    const streamResult = await agent.stream(agentDialogueInput as any, {
      abortSignal: abortController.signal,
      toolChoice: 'required',
    });

    for await (const chunk of streamResult.fullStream) {
      if (chunk.type === 'reasoning-delta' && chunk.payload?.text) {
        // Mastra 官方原生思考过程流，直接推送前端思考面板
        const reasoningText = chunk.payload.text;
        fullThought += reasoningText;
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'thought', thought: reasoningText })}\n\n`);
          (res as any).flush?.();
        }
      } else if (chunk.type === 'text-delta' && chunk.payload?.text) {
        // Mastra 官方原生打字机正文文本切片，秒级直出流向前端
        const text = chunk.payload.text;
        fullReply += text;
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n\n`);
          (res as any).flush?.();
        }
      }
    }

    // 4. 提取本次对话触发的原生 Tool Call 意图信号 (SSOT 纯粹源头提取，零兼容兜底)
    const detectedIntent = await extractDirectorIntent(streamResult);
    console.log(`[chat] 项目 [${projectId}] 流式结束，意图决策提取结果:`, detectedIntent);

    let newProposal: ActionProposal | undefined;
    if (detectedIntent) {
      newProposal = await resolveIntentToProposal(projectId, sessionId, detectedIntent, cleanUserText);
    } else {
      const currentPendingList = proposalStore.listProposals(projectId, { status: 'pending' });
      newProposal = currentPendingList.find((p) => !initialProposalIds.has(p.actionId));
      if (!newProposal && justApprovedProposal) {
        newProposal = (approvedProposalId ? proposalStore.getProposal(projectId, approvedProposalId) : undefined) || justApprovedProposal;
      }
    }

    if (newProposal && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'proposal', proposal: newProposal })}\n\n`);
    }

    const isExecutionTrigger = Boolean(approvedProposalId || detectedIntent?.action === 'approve');

    // 6. 触发对话完成事件 (向前端回传 fullText 与 finalProposal)
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          fullText: fullReply,
          finalProposal: newProposal,
          isExecutionTrigger,
        })}\n\n`
      );
    }

    // 7. 持久化记录助手回复
    const assistantMsg = {
      role: 'assistant',
      content: fullReply.trimStart(),
      thought: fullThought || undefined,
      timestamp: new Date().toISOString(),
      proposal: newProposal,
      isExecutionTrigger,
    };
    projectStore.appendMessage(projectId, sessionId, assistantMsg as any);
  } catch (streamErr: any) {
    console.error(`[HTTP API] SSE 流式生成异常:`, streamErr);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: streamErr?.message || '生成中断' })}\n\n`);
    }

    // Turns 角色严格交替防御：流式中断时补录占位消息
    if (!fullReply.trim()) {
      memoryManager.recordAssistantFallback(projectId, sessionId, streamErr?.message || '流式连接异常');
    }
  } finally {
    req.off('close', onClose);
    res.off('close', onClose);
    if (!res.writableEnded) {
      res.write(`data: [DONE]\n\n`);
      res.end();
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 模块 C：主 HTTP 路由网关控制器 (Chat Route Gateway)
 * 职责：入口校验、会话管理、多轮历史检索、流式与非流式分发
 * ══════════════════════════════════════════════════════════════════════════════ */

/** 确保当前项目与会话白板就绪 (SSOT) */
function ensureProjectAndSession(
  projectId?: string,
  sessionId?: string,
  initialUserMessage: string = ''
): { effectiveProjectId: string; effectiveSessionId: string } {
  const projectStore = ProjectStore.getInstance();

  let effectiveProjectId = projectId;
  if (!effectiveProjectId) {
    const now = new Date().toISOString();
    effectiveProjectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    projectStore.saveProject({
      projectId: effectiveProjectId,
      title: '全新互动影游项目',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: initialUserMessage || '',
        style: '电影质感，写实光影',
        videoRatio: '16:9',
        videoResolution: '720P' as const,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

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

  return { effectiveProjectId, effectiveSessionId };
}

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
    const { message, projectId, sessionId, approvedProposalId, overrideParameters } = body;
    const wantsStream = req.headers.accept === 'text/event-stream' || searchParams.get('stream') === 'true';

    // 1. 确保项目与会话有效
    const { effectiveProjectId, effectiveSessionId } = ensureProjectAndSession(projectId, sessionId, message);

    console.log(`[HTTP API] 对话干预 -> 项目 [${effectiveProjectId}][会话: ${effectiveSessionId}]: "${message}" (流式: ${wantsStream})`);

    // 2. 若创作者通过卡片按钮推进，原子启动该被批准提案
    let justApprovedProposal: ActionProposal | undefined;
    if (approvedProposalId) {
      console.log(`[HTTP API] 对话驱动批准执行提案 [${approvedProposalId}] -> 项目 [${effectiveProjectId}]`);
      try {
        const startResult = await Workflow.getInstance().startProposal({
          projectId: effectiveProjectId,
          proposalId: approvedProposalId,
          overrideParameters,
        });
        justApprovedProposal = startResult.proposal;
      } catch (err: any) {
        console.warn(`[HTTP API] 对话驱动启动提案非致命提示:`, err.message);
      }
    }

    // 3. 记录本次用户发言
    const cleanUserText = (message || '').trim() || '请根据当前项目进展提出导演专业建议';
    projectStore.appendMessage(effectiveProjectId, effectiveSessionId, {
      role: 'user',
      content: cleanUserText,
      timestamp: new Date().toISOString(),
    } as any);

    // 4. 记录既有提案快照，用于比对新增
    const initialProposalIds = new Set(
      proposalStore.listProposals(effectiveProjectId).map((p) => p.actionId)
    );

    // 5. 组装微观工作记忆 Turns（严格保障 user 首发与角色交替）
    const memoryManager = ChatMemoryManager.getInstance();
    const agentDialogueInput = memoryManager.getWorkingTurns(
      effectiveProjectId,
      effectiveSessionId,
      10,
      cleanUserText
    );
    if (agentDialogueInput.length === 0 || agentDialogueInput[agentDialogueInput.length - 1].role !== 'user') {
      agentDialogueInput.push({ role: 'user', content: cleanUserText });
    }

    // 6. 构造 AI 视听总导演智能体
    const agent = createDirectorAgent(effectiveProjectId, effectiveSessionId);

    // 7. 分流：流式 SSE 打字机通道
    if (wantsStream) {
      await runSseStreamPipeline({
        req,
        res,
        agent,
        agentDialogueInput,
        projectId: effectiveProjectId,
        sessionId: effectiveSessionId,
        cleanUserText,
        initialProposalIds,
        justApprovedProposal,
        approvedProposalId,
      });
      return true;
    }

    // 8. 分流：非流式同步直出通道 (Mastra 原生响应直出, 强制 toolChoice: 'required')
    const response = await agent.generate(agentDialogueInput as any, {
      toolChoice: 'required',
    });

    const finalReply = response.text || '';
    const finalThought = (response as any).reasoning || undefined;

    // 从原生 Tool Calls 提取意图 (SSOT 纯粹源头提取)
    const detectedIntent = await extractDirectorIntent(response);

    let newProposal: ActionProposal | undefined;
    if (detectedIntent) {
      newProposal = await resolveIntentToProposal(
        effectiveProjectId,
        effectiveSessionId,
        detectedIntent,
        cleanUserText
      );
    } else {
      const currentPendingList = proposalStore.listProposals(effectiveProjectId, { status: 'pending' });
      newProposal = currentPendingList.find((p) => !initialProposalIds.has(p.actionId));
      if (!newProposal && justApprovedProposal) {
        newProposal = (approvedProposalId ? proposalStore.getProposal(effectiveProjectId, approvedProposalId) : undefined) || justApprovedProposal;
      }
    }

    let safeReply = (finalReply || '').trim();
    if (!safeReply && newProposal) {
      safeReply = `收到您的创作构想！我已为您评估好【${newProposal.label}】实施方案，请查阅下方生成的行动卡片，确认授权后即可开启本阶段制作。`;
    } else if (!safeReply) {
      safeReply = '导演已收到您的指令，正在为您构思推演中...';
    }

    projectStore.appendMessage(effectiveProjectId, effectiveSessionId, {
      role: 'assistant',
      content: safeReply,
      thought: finalThought || undefined,
      timestamp: new Date().toISOString(),
      proposal: newProposal,
    } as any);

    sendJson(res, 200, {
      success: true,
      projectId: effectiveProjectId,
      sessionId: effectiveSessionId,
      reply: safeReply,
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
