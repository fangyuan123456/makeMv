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
import { ProjectStore, TaskStore } from '../../project-store/index.js';
import {
  getWorkingTurns,
  recentUserInstructions,
  appendAssistantMessage,
} from '../../project-store/conversation.js';
import { createDirectorAgent, extractDirectorIntent, type AgentIntentSignal } from '../../agents/director/index.js';
import { resolveModifySource } from '../../agents/director/modifier/index.js';
import { previewModifyImpact } from '../../agents/director/modifier/impact.js';
import { WorkflowStage, SessionStatus, STAGE_SEQUENCE, type Task } from '../../types/index.js';
import { Workflow } from '../../workflow-engine/index.js';
import { STAGE_TRANSITION_MAP, SKILL_OF_STAGE, STAGE_OF_SKILL } from '../../agents/director/constants.js';
import { readJsonBody, sendJson, sendError } from '../helpers.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * 模块 0：上游空响应重试包装
 * 背景：硅基流动偶发返回 200 + 空 choices，Mastra 内部抛 InvalidResponseDataError
 *       ("Response did not contain any choices")。该错误不属于 AI SDK 的
 *       APICallError，maxRetries 不会重试，只能在路由层自行重试。
 * ══════════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════════
 * 模块 A：意图向任务解析器 (Intent ➔ Task SSOT)
 * 职责：纯业务领域逻辑。接收大模型 Tool Call 意图信号，结合项目黑板状态与门禁，
 *       产出唯一状态载体 Task（proposed 待确认 / queued 待执行 / 直接 running）。
 * ══════════════════════════════════════════════════════════════════════════════ */

async function resolveIntentToTask(
  projectId: string,
  sessionId: string,
  intent: AgentIntentSignal,
  userMessage: string
): Promise<Task | undefined> {
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

  // 3. 刚性防重放守卫：若当前已有工序处于 running 执行中，复用该任务，拦截大模型重复发放新任务
  const taskStore = TaskStore.getInstance();
  const existingRunning = taskStore.listTasks(projectId, { status: 'running' });
  if (existingRunning.length > 0 && intent.action === 'next') {
    console.log(`[chat] 检测到当前已有工序 [${existingRunning[0].skill}] 处于 running 执行中，复用该任务，拦截重复派发`);
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
        return dispatchRes.task;
      }
      return undefined;
    }

    case 'approve': {
      // 创作者打字同意/开启：激活启动当前待确认任务
      const currentProposedList = taskStore.listTasks(projectId, { status: 'proposed' });
      if (currentProposedList.length > 0) {
        const targetTask = currentProposedList[currentProposedList.length - 1];
        console.log(`[Director Intent] AI 识别创作者打字批准意图 -> 启动任务 [${targetTask.taskId}] (${targetTask.title})`);
        const startResult = await engine.startTask({
          projectId,
          taskId: targetTask.taskId,
        });
        return startResult.task;
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
      return dispatchRes.task;
    }

    case 'modify': {
      const userInstruction = intent.content || userMessage;

      /*
       * 唯一裁决：从事实源头改起。
       *
       * 这里不再采用「大模型猜的工序」作为落地点——模型只能判断"改什么"，
       * 判断不了"这个事实由哪份产物定义"。裁决权交给 resolveModifySource：
       * 它在黑板里定位实体最早出现的产物作为源头，并算出会失效的下游阶段。
       * 图像/视频产物永远不是事实源，涉及年龄/身份/剧情的诉求不会从媒体轨改起。
       */
      const plan = await resolveModifySource(projectId, {
        target: intent.target,
        content: userInstruction,
        currentStage,
        skillHint: intent.skill,
        history: recentUserInstructions(projectId, sessionId, userInstruction),
      });

      if (intent.skill && intent.skill !== plan.sourceSkill) {
        console.log(
          `[chat] 微调源头裁决: 模型建议 [${intent.skill}] → 事实源头 [${plan.sourceSkill}]` +
            `（属性=${plan.attribute}，${plan.reason}）`
        );
      }
      if (plan.cascadeStages.length > 0) {
        console.log(
          `[chat] 预计受影响下游: ${plan.cascadeStages.join(' → ')}` +
            `（实际清退以修改轨上报的 changedStages 为准）`
        );
      }

      // 项目尚无任何文本产物：微调无处落地，降级为该工序的生成提案（pending 待审）
      if (plan.basis === 'no-source') {
        console.warn(
          `[chat] 拦截空转微调: 工序 [${plan.sourceSkill}] 尚无已落盘产物，modify 意图自动降级为生成提案`
        );
        const downgradeRes = await engine.dispatch({
          projectId,
          sessionId,
          workflowKey: plan.sourceSkill,
          actionType: 'PROCEED_STAGE',
          reason: `生成工序 [${plan.sourceSkill}]（微调请求因产物未就绪自动转为生成）`,
          userPrompt: userInstruction,
          requireConfirmation: true,
        });
        return downgradeRes.task;
      }

      /*
       * 同一句话里落在其他源头的诉求（「台词压短，镜头换中景」）。
       *
       * 分三种处置，判据在裁决器里（AdditionalAsk.relation）：
       * - merged：同为文本轨，本单的跨文件补丁已经覆盖，不需要额外动作；
       * - downstream：可以追加，但必须等本单落地后再定「改」还是「重生成」，
       *   所以只写进 payload，由主单的成功钩子（follow-up.ts）接单，且派发成待确认；
       * - upstream：目标阶段在本单之前，追加会把本单产物清退，只记录不执行。
       */
      const additional = plan.additionalAsks || [];
      const followUps = additional.filter((a) => a.relation === 'downstream');
      const merged = additional.filter((a) => a.relation === 'merged');
      const blocked = additional.filter((a) => a.relation === 'upstream');

      if (merged.length > 0) {
        console.log(
          `[chat] 同句诉求同属文本轨，本单跨文件补丁一并处理: ${merged
            .map((a) => `「${a.clause}」`)
            .join('、')}`
        );
      }
      if (followUps.length > 0) {
        console.log(
          `[chat] 同句另有下游诉求，待本单完成后接单: ${followUps
            .map((a) => `「${a.clause}」→ ${a.sourceSkill}`)
            .join('、')}`
        );
      }
      if (blocked.length > 0) {
        console.log(
          `[chat] 同句含上游诉求，本单不回改（会清退刚产出的产物）: ${blocked
            .map((a) => `「${a.clause}」→ ${a.sourceSkill}`)
            .join('、')}`
        );
      }

      const tailNote = [
        merged.length > 0 ? `同句另含：${merged.map((a) => `「${a.clause}」`).join('、')}（文本轨本单一并处理）` : '',
        followUps.length > 0
          ? `同句另需：${followUps.map((a) => `「${a.clause}」→ ${a.sourceSkill}`).join('、')}（本单完成后接单）`
          : '',
        blocked.length > 0
          ? `另有上游诉求：${blocked.map((a) => `「${a.clause}」`).join('、')}（需先于本单执行，本轮不做）`
          : '',
      ]
        .filter(Boolean)
        .join('；');

      /*
       * 待确认卡片上的影响面：从产物血缘图算「这一改会让哪些已生成资产作废」。
       * 纯读、不阻断、失败静默降级——提示信息不该让修改任务派发失败。
       * 识别不出具体变更对象时 preview 返回 null，前端就不展示这块。
       */
      const impactPreview = previewModifyImpact(
        ProjectStore.getInstance().getProject(projectId)?.stageArtifacts,
        userInstruction
      );

      const dispatchRes = await engine.dispatch({
        projectId,
        sessionId,
        workflowKey: plan.sourceSkill,
        actionType: 'TARGETED_REVISE',
        reason: (userInstruction || `定向微调 [${plan.sourceSkill}]（${plan.reason}）`) + (tailNote ? `；${tailNote}` : ''),
        userPrompt: userInstruction,
        parameters: {
          target: intent.target,
          userFeedback: userInstruction,
          sourceBasis: plan.basis,
          sourceAttribute: plan.attribute,
          cascadeStages: plan.cascadeStages,
          additionalAsks: additional,
          // 显式写 null：幂等复用会合并旧 payload，不覆盖的话上一条的影响面会残留成误导
          impact: impactPreview,
          // 只把可追加的下游诉求交给成功钩子；merged 已由本单覆盖，upstream 会打架
          followUpAsks: followUps,
        },
      });

      return dispatchRes.task;
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
      return dispatchRes.task;
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
      return dispatchRes.task;
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
  initialTaskIds: Set<string>;
  justApprovedTask?: Task;
  approvedTaskId?: string;
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
    initialTaskIds,
    justApprovedTask,
    approvedTaskId,
  } = params;

  const projectStore = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();

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
    // 3. 启动 Mastra Agent 单阶段原生流式通道 (fullStream SSOT)
    //    prepareStep 按步控制 toolChoice：仅第 0 步强制 'required' 100% 出意图工具调用，
    //    后续步骤回归 'auto' 让模型正常输出正文。
    //    注意：严禁全局 'required' —— 会被应用到大循环每一步，模型被迫连续调工具直到
    //    maxSteps 耗尽、正文为空 (59bf2ea 回归)。
    //    (prepareStep 机制已经本地 mock 取证 + 真实环境 3/3 验证可用，2026-11-07)
    const tStream = Date.now();
    const streamResult = await agent.stream(agentDialogueInput as any, {
      abortSignal: abortController.signal,
      prepareStep: ({ stepNumber }: any) =>
        stepNumber === 0 ? { toolChoice: 'required' as const } : { toolChoice: 'auto' as const },
    } as any);
    console.log(`[chat] 正文流建立耗时 ${((Date.now() - tStream) / 1000).toFixed(1)}s`);

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

    // 4. 提取本次对话触发的原生 Tool Call 意图信号 (SSOT 纯粹源头提取，来自同一流)
    const detectedIntent = await extractDirectorIntent(streamResult);
    console.log(`[chat] 项目 [${projectId}] 流式结束，意图决策提取结果:`, detectedIntent);

    // 本轮对应的任务：
    // - 批准轮：必须归属「刚批准的那个任务」，否则进度/成果会挂到意图模型顺手派发的新任务上；
    // - 普通轮：归属意图派发新建的任务（或本轮新出现的待审任务）。
    let roundTask: Task | undefined;
    if (approvedTaskId) {
      roundTask = taskStore.getTask(projectId, approvedTaskId) || justApprovedTask;
    } else if (detectedIntent) {
      roundTask = await resolveIntentToTask(projectId, sessionId, detectedIntent, cleanUserText);
    } else {
      roundTask = taskStore
        .listTasks(projectId, { status: 'proposed' })
        .find((t) => !initialTaskIds.has(t.taskId));
    }

    if (roundTask && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'task', task: roundTask })}\n\n`);
    }

    // 6. 触发对话完成事件
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          fullText: fullReply,
          taskId: roundTask?.taskId,
          task: roundTask,
        })}\n\n`
      );
    }

    // 7. 持久化助手回复：只保存 taskId 引用，状态与产物一律从任务仓库读取
    projectStore.appendMessage(projectId, sessionId, {
      role: 'assistant',
      content: fullReply.trimStart(),
      thought: fullThought || undefined,
      timestamp: new Date().toISOString(),
      taskId: roundTask?.taskId,
    } as any);
  } catch (streamErr: any) {
    console.error(`[HTTP API] SSE 流式生成异常:`, streamErr);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: streamErr?.message || '生成中断' })}\n\n`);
    }

    // Turns 角色严格交替防御：流式中断时补录占位消息
    if (!fullReply.trim()) {
      appendAssistantMessage(
        projectId,
        sessionId,
        `[导演思考被中断: ${streamErr?.message || '流式连接异常'}，请重试或继续下发指令]`
      );
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
  const taskStore = TaskStore.getInstance();

  try {
    const body = await readJsonBody(req);
    const { message, projectId, sessionId, overrideParameters } = body;
    // approvedTaskId 为现行口径；approvedProposalId 保留兼容旧客户端
    const approvedTaskId: string | undefined = body.approvedTaskId || body.approvedProposalId;
    const wantsStream = req.headers.accept === 'text/event-stream' || searchParams.get('stream') === 'true';

    // 1. 确保项目与会话有效
    const { effectiveProjectId, effectiveSessionId } = ensureProjectAndSession(projectId, sessionId, message);

    console.log(`[HTTP API] 对话干预 -> 项目 [${effectiveProjectId}][会话: ${effectiveSessionId}]: "${message}" (流式: ${wantsStream})`);

    // 2. 若创作者通过卡片按钮推进，原子启动该被批准任务
    let justApprovedTask: Task | undefined;
    if (approvedTaskId) {
      console.log(`[HTTP API] 对话驱动批准执行任务 [${approvedTaskId}] -> 项目 [${effectiveProjectId}]`);
      try {
        const startResult = await Workflow.getInstance().startTask({
          projectId: effectiveProjectId,
          taskId: approvedTaskId,
          overrideParameters,
        });
        justApprovedTask = startResult.task;
      } catch (err: any) {
        console.warn(`[HTTP API] 对话驱动启动任务非致命提示:`, err.message);
      }
    }

    // 3. 记录本次用户发言
    const cleanUserText = (message || '').trim() || '请根据当前项目进展提出导演专业建议';
    projectStore.appendMessage(effectiveProjectId, effectiveSessionId, {
      role: 'user',
      content: cleanUserText,
      timestamp: new Date().toISOString(),
    } as any);

    // 4. 记录既有任务快照，用于比对本轮新增
    const initialTaskIds = new Set(
      taskStore.listTasks(effectiveProjectId).map((t) => t.taskId)
    );

    // 5. 组装微观工作记忆 Turns（严格保障 user 首发与角色交替）
    const agentDialogueInput = getWorkingTurns(
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
        initialTaskIds,
        justApprovedTask,
        approvedTaskId,
      });
      return true;
    }

    // 8. 分流：非流式同步直出通道 (与流式同款 prepareStep 策略：仅首步 required，其余步 auto)
    const response: any = await agent.generate(agentDialogueInput as any, {
      prepareStep: ({ stepNumber }: any) =>
        stepNumber === 0 ? { toolChoice: 'required' as const } : { toolChoice: 'auto' as const },
    } as any);

    const finalReply = response.text || '';
    const finalThought = (response as any).reasoning || undefined;

    // 从原生 Tool Calls 提取意图 (SSOT 纯粹源头提取)
    const detectedIntent = await extractDirectorIntent(response);

    let roundTask: Task | undefined;
    if (approvedTaskId) {
      roundTask = taskStore.getTask(effectiveProjectId, approvedTaskId) || justApprovedTask;
    } else if (detectedIntent) {
      roundTask = await resolveIntentToTask(
        effectiveProjectId,
        effectiveSessionId,
        detectedIntent,
        cleanUserText
      );
    } else {
      roundTask = taskStore
        .listTasks(effectiveProjectId, { status: 'proposed' })
        .find((t) => !initialTaskIds.has(t.taskId));
    }

    let safeReply = (finalReply || '').trim();
    if (!safeReply && roundTask) {
      safeReply = `收到您的创作构想！我已为您评估好【${roundTask.title}】实施方案，请查阅下方任务卡片，确认授权后即可开启本阶段制作。`;
    } else if (!safeReply) {
      safeReply = '导演已收到您的指令，正在为您构思推演中...';
    }

    // 消息只存 taskId 引用，不再内嵌任何任务状态快照
    projectStore.appendMessage(effectiveProjectId, effectiveSessionId, {
      role: 'assistant',
      content: safeReply,
      thought: finalThought || undefined,
      timestamp: new Date().toISOString(),
      taskId: roundTask?.taskId,
    } as any);

    sendJson(res, 200, {
      success: true,
      projectId: effectiveProjectId,
      sessionId: effectiveSessionId,
      reply: safeReply,
      thought: finalThought || undefined,
      taskId: roundTask?.taskId,
      task: roundTask,
    });
    return true;
  } catch (err: any) {
    console.error('[HTTP API] 对话调度异常:', err);
    sendError(res, 500, '对话调度异常，请稍后重试');
    return true;
  }
}
