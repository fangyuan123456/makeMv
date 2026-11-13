/**
 * api/routes/chat-stream-manager.ts
 * 中枢对话后台流式生成托管与断线续传广播器 (Resumable SSE Multiplexer)
 *
 * 核心机制：
 * 1. 大模型生成流 (streamRouterDialogue) 与单次 HTTP 响应解耦，客户端刷新断连不中断后台推演；
 * 2. 流式期间按约 350ms 节流刷新磁盘 placeholder 消息，结束写终态与 proposal / task；
 * 3. 若识别到创作者打字发送 approve_stage 批准意图，与点击确认按钮等价——服务端当即启动/推进流水线并下发 task 事件；
 * 4. 重连或新订阅进入时在单线程同步区下发完整 snapshot 再挂载 subscribers，绝不丢字或重字。
 */

import type { Request, Response } from 'express';
import { streamRouterDialogue } from '../../agents/router/router.agent.js';
import {
  extractRouterIntentFromSteps,
  type ExtractedRouterProposal,
  type RouterIntentToolContext,
} from '../../agents/router/tools/emit-intent.tool.js';
import { buildWorkingDialogueTurns } from '../../mastra-compat/index.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { ProductionWorkflowEngine } from '../../workflows/production.workflow.js';
import { TaskStore } from '../../workflow-engine/TaskStore.js';
import { combineAbortSignals } from '../../workflow-engine/run-context.js';

export interface ChatHistoryTaskRef {
  runId?: string;
  stage?: string;
  status?: string;
  title?: string;
  note?: string;
}

export interface ChatHistoryTurnInput {
  role: string;
  content: string;
  task?: ChatHistoryTaskRef;
}

export interface ActiveChatTask {
  runId: string;
  stage: 'plan_gdd' | 'build_text_game';
  title: string;
  status: 'running';
  /** 若该 (runId, stage) 之前已在聊天记录中创建过任务气泡，则指向既有气泡就地更新，不再新建第二个任务框 */
  ownerMessageId?: string;
}

export interface ActiveChatStream {
  projectId: string;
  messageId: string;
  /** 本轮创作者发言的气泡 id：整轮撤销时一并回收 */
  userMessageId?: string;
  accumulatedText: string;
  proposal?: Record<string, any>;
  task?: ActiveChatTask;
  errorMessage?: string;
  /** 本轮气泡已被撤销（意图落到既有任务气泡上，不再需要单独回复） */
  removed?: boolean;
  status: 'streaming' | 'done' | 'error';
  subscribers: Set<Response>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  createdAt: number;
  lastChunkAt: number;
  abortController?: AbortController;
}

const STREAM_FLUSH_INTERVAL_MS = 350;
const FINISHED_STREAM_TTL_MS = 60_000;
/**
 * 首字超时：上游连第一个 token 都不给，前端就会一直转圈且没有任何提示。
 * 到点直接掐断本轮，交给下面的重试 / 报错路径，让失败可见。
 */
const FIRST_TOKEN_TIMEOUT_MS = 90_000;
/** 字间空闲超时：已经开吐之后卡住同样不放过（一次完整回复不该停顿这么久）。 */
const STREAM_IDLE_TIMEOUT_MS = 45_000;

/**
 * 上游 SSE 可能在首个 delta 之后断流，AI SDK 会把断流当成正常结束（不抛错）。
 * 这里只做结构判断、不猜中文语义：有提案时，一轮完整回复不该短于提案摘要本身。
 * 以摘要长度作参照而非写死阈值，换题材 / 换提示词都不用调数字。
 */
export function isTruncatedReply(text: string, summary: string): boolean {
  const ref = (summary || '').trim();
  return ref.length > 0 && (text || '').trim().length < ref.length;
}

export class ChatStreamManager {
  private static instance: ChatStreamManager | null = null;
  private streams = new Map<string, ActiveChatStream>();
  private store = ProjectStore.getInstance();

  private constructor() {}

  public static getInstance(): ChatStreamManager {
    if (!ChatStreamManager.instance) {
      ChatStreamManager.instance = new ChatStreamManager();
    }
    return ChatStreamManager.instance;
  }

  public isStreaming(projectId: string): boolean {
    return this.streams.get(projectId)?.status === 'streaming';
  }

  private writeSseHeaders(res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }
  }

  private safeSend(res: Response, payload: Record<string, any> | '[DONE]'): void {
    if (res.writableEnded || res.destroyed) return;
    try {
      if (payload === '[DONE]') {
        res.write('data: [DONE]\n\n');
      } else {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    } catch {
      // 客户端已断开时忽略写入异常
    }
  }

  private broadcast(stream: ActiveChatStream, payload: Record<string, any>): void {
    for (const sub of [...stream.subscribers]) {
      if (sub.writableEnded || sub.destroyed) {
        stream.subscribers.delete(sub);
        continue;
      }
      this.safeSend(sub, payload);
    }
  }

  private broadcastDoneAndClose(stream: ActiveChatStream): void {
    for (const sub of [...stream.subscribers]) {
      this.safeSend(sub, '[DONE]');
      if (!sub.writableEnded && !sub.destroyed) {
        try {
          sub.end();
        } catch {}
      }
    }
    stream.subscribers.clear();
  }

  public startStream(params: {
    projectId: string;
    message: string;
    history: ChatHistoryTurnInput[];
  }): ActiveChatStream {
    const { projectId, message, history } = params;
    const prev = this.streams.get(projectId);
    if (prev?.status === 'streaming') {
      const now = Date.now();
      const isStale =
        (now - (prev.createdAt || 0) > 75_000 && !prev.accumulatedText) ||
        (now - (prev.lastChunkAt || 0) > 45_000) ||
        (prev.subscribers.size === 0 && now - (prev.createdAt || 0) > 30_000);

      if (isStale) {
        console.warn(
          `[ChatStreamManager] 检测到项目 [${projectId}] 存在僵死流 (存活 ${Math.round(
            (now - (prev.createdAt || 0)) / 1000
          )}s, 字数 ${prev.accumulatedText.length})，主动触发熔断自愈并放行新对话`
        );
        try {
          prev.abortController?.abort(new Error('[ChatStreamManager] 新请求进入，僵死流被强制抢占'));
        } catch {}
        prev.status = 'error';
        prev.errorMessage = '上游响应超时，已被新对话重置';
        this.broadcastDoneAndClose(prev);
        this.streams.delete(projectId);
      } else {
        throw new Error(`[409 Conflict] 项目 [${projectId}] 的总导演正在回复中，请稍候`);
      }
    }
    if (prev?.cleanupTimer) {
      clearTimeout(prev.cleanupTimer);
    }

    const userMsg = this.store.appendChatRecord(projectId, {
      role: 'user',
      content: message,
      status: 'done',
    });

    const placeholder = this.store.appendChatRecord(projectId, {
      role: 'assistant',
      content: '',
      status: 'streaming',
    });

    const now = Date.now();
    const stream: ActiveChatStream = {
      projectId,
      messageId: placeholder.id,
      userMessageId: userMsg.id,
      accumulatedText: '',
      status: 'streaming',
      subscribers: new Set(),
      createdAt: now,
      lastChunkAt: now,
    };
    this.streams.set(projectId, stream);

    void this.runBackgroundStream(stream, message, history, [userMsg.id, placeholder.id]);
    return stream;
  }

  public subscribe(projectId: string, _req: Request, res: Response): void {
    this.writeSseHeaders(res);
    const active = this.streams.get(projectId);

    if (active) {
      // 本轮气泡已被撤销：只通知前端摘掉本轮气泡（含创作者发言），不再下发正文快照
      if (active.removed) {
        this.safeSend(res, { type: 'remove', messageId: active.messageId, turn: true });
        this.safeSend(res, '[DONE]');
        res.end();
        return;
      }

      this.safeSend(res, {
        type: 'snapshot',
        messageId: active.messageId,
        content: active.accumulatedText,
      });

      if (active.proposal) {
        this.safeSend(res, { type: 'proposal', proposal: active.proposal });
      }
      if (active.task) {
        this.safeSend(res, { type: 'task', task: active.task });
      }

      if (active.status === 'streaming') {
        active.subscribers.add(res);
        // 仅监听 res.on('close')：POST 请求体在 express.json() 读完后 req 即触发 close，不能用来移除订阅
        res.on('close', () => {
          active.subscribers.delete(res);
        });
        return;
      }

      if (active.status === 'error' && active.errorMessage) {
        this.safeSend(res, { type: 'error', error: active.errorMessage });
      }
      this.safeSend(res, '[DONE]');
      res.end();
      return;
    }

    // 内存无活跃流（如服务曾重启）：读磁盘并修复可能残留的 streaming 占位态
    const proj = this.store.getProject(projectId);
    const lastAssistant = [...(proj.chat || [])].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant) {
      if (lastAssistant.status === 'streaming') {
        this.store.updateChatRecord(projectId, lastAssistant.id, { status: 'done' });
      }
      this.safeSend(res, {
        type: 'snapshot',
        messageId: lastAssistant.id,
        content: lastAssistant.content || '',
      });
      if (lastAssistant.proposal) {
        this.safeSend(res, { type: 'proposal', proposal: lastAssistant.proposal });
      }
    }
    this.safeSend(res, '[DONE]');
    res.end();
  }

  /**
   * 创作者通过对话打字触发 approve_stage / resume_task 时：
   * - resume_task：复用指定 taskId 唤醒中断流水线；
   * - approve_stage：当即启动阶段一或推进阶段二，并把任务挂载到本轮回复气泡。
   */
  private async executeApprovedIntent(
    stream: ActiveChatStream,
    proposal: ExtractedRouterProposal
  ): Promise<ActiveChatTask | undefined> {
    const projectId = stream.projectId;
    const taskStore = TaskStore.getInstance();

    const findOwnerMessageId = (runId: string, stage: ActiveChatTask['stage']): string | undefined => {
      const chat = this.store.getProject(projectId).chat || [];
      return chat.find((m) => m.taskRunId === runId && (m.taskStage || 'plan_gdd') === stage)?.id;
    };

    // 1. 运行中互斥保护：已有任务跑在后台时直接复用绑定，绝不重复启动
    const runningTask = taskStore.getRunningTask(projectId);
    if (runningTask) {
      const currentStage = (runningTask.result as any)?.currentStage;
      const stage: ActiveChatTask['stage'] =
        currentStage === 'build_text_game' ? 'build_text_game' : 'plan_gdd';
      const ownerMessageId = findOwnerMessageId(runningTask.taskId, stage);
      this.store.markChatProposalsResolved(projectId);
      return {
        runId: runningTask.taskId,
        stage,
        title: stage === 'build_text_game' ? '装配互动文游 (index.html)' : '推演游戏策划案 (GDD)',
        status: 'running',
        ...(ownerMessageId ? { ownerMessageId } : {}),
      };
    }

    // 1.5 定向任务恢复（resume_task）：直接把识别出的 taskId 传入 ProductionWorkflowEngine.resume
    if (proposal.action === 'resume_task') {
      const targetTaskId = typeof proposal.taskId === 'string' ? proposal.taskId.trim() : '';
      if (!targetTaskId) {
        return undefined;
      }
      const snapshot = await ProductionWorkflowEngine.resume(projectId, targetTaskId, {
        approved: true,
      });
      this.store.markChatProposalsResolved(projectId);
      const stage: ActiveChatTask['stage'] =
        snapshot.currentStage === 'build_text_game' ? 'build_text_game' : 'plan_gdd';
      const ownerMessageId = findOwnerMessageId(targetTaskId, stage);
      return {
        runId: targetTaskId,
        stage,
        title: stage === 'build_text_game' ? '装配互动文游 (index.html)' : '推演游戏策划案 (GDD)',
        status: 'running',
        ...(ownerMessageId ? { ownerMessageId } : {}),
      };
    }

    // 1.8 定向资产精修（modify_asset 或对前序未决精修提案的确认）：
    const isDirectModify = proposal.action === 'modify_asset';
    const proj = this.store.getProject(projectId);
    const priorMessages = (proj.chat || []).filter((m) => m.id !== stream.messageId);
    const priorPendingModify = [...priorMessages]
      .reverse()
      .find((m) => m.proposal?.action === 'modify_asset' && !m.proposalResolved);

    if (isDirectModify || (proposal.action === 'approve_stage' && priorPendingModify)) {
      const activeModifyProposal = isDirectModify ? proposal : priorPendingModify?.proposal;
      const target =
        (typeof activeModifyProposal?.payload?.target === 'string' &&
          activeModifyProposal.payload.target.trim()) ||
        '策划案产物';
      const detail =
        (typeof activeModifyProposal?.payload?.detail === 'string' &&
          activeModifyProposal.payload.detail.trim()) ||
        activeModifyProposal?.summary ||
        '';

      if (detail) {
        const runId = await ProductionWorkflowEngine.modify(projectId, target, detail);
        this.store.markChatProposalsResolved(projectId);
        return {
          runId,
          stage: 'plan_gdd',
          title: `定向精修策划案：${target}`,
          status: 'running',
        };
      }
    }

    // 2. 阶段二推进：若存在挂起在「策划案 / 定妆」确认点的任务，直接 resume 往下走
    //    （具体走哪一段由引擎按 pendingApproval.type 判定：gdd→提取实体，lookdev→出图+装配）
    const allTasks = taskStore.listTasks(projectId);
    const suspendedApprovalTask = [...allTasks]
      .reverse()
      .find((t) => {
        const pendingType = (t.result as any)?.pendingApproval?.type;
        return (
          t.status === 'suspended' &&
          (pendingType === 'gdd_approval' || pendingType === 'lookdev_approval')
        );
      });

    if (suspendedApprovalTask) {
      await ProductionWorkflowEngine.resume(projectId, suspendedApprovalTask.taskId, {
        approved: true,
      });
      this.store.markTaskNextProposalResolved(projectId, suspendedApprovalTask.taskId);
      this.store.markChatProposalsResolved(projectId);
      return {
        runId: suspendedApprovalTask.taskId,
        stage: 'build_text_game',
        title: '装配互动文游 (index.html)',
        status: 'running',
      };
    }

    // 3. 若已经完成文游阶段（无挂起 GDD 且已有 text_game 产物），不越权重复立项
    if (this.store.getArtifact(projectId, 'text_game')) {
      return undefined;
    }

    // 4. 启动阶段一：从本次意图、既有未决提案或历史创意发言中提炼完整 userPrompt
    if (!this.store.getArtifact(projectId, 'gdd')) {
      const proj = this.store.getProject(projectId);
      const priorMessages = (proj.chat || []).filter((m) => m.id !== stream.messageId);

      const fromCurrentPayload =
        typeof proposal.payload?.userPrompt === 'string'
          ? proposal.payload.userPrompt.trim()
          : '';

      const priorStartProposal = [...priorMessages]
        .reverse()
        .find(
          (m) =>
            (m.proposal?.action === 'propose_stage' || m.proposal?.action === 'start_pipeline') &&
            m.proposal?.payload?.userPrompt
        );
      const fromPriorProposal =
        typeof priorStartProposal?.proposal?.payload?.userPrompt === 'string'
          ? priorStartProposal.proposal.payload.userPrompt.trim()
          : '';

      const effectivePrompt = fromCurrentPayload || fromPriorProposal;
      if (!effectivePrompt) {
        return undefined;
      }

      const runId = await ProductionWorkflowEngine.start(projectId, effectivePrompt);
      this.store.markChatProposalsResolved(projectId);
      return {
        runId,
        stage: 'plan_gdd',
        title: '推演游戏策划案 (GDD)',
        status: 'running',
      };
    }

    return undefined;
  }

  /**
   * 构造对 AI 可见的任务记录对话历史：每条关联任务的对话行都会真实暴露 taskId 与 TaskStore 实时状态
   */
  private buildTaskAwareDialogueHistory(
    projectId: string,
    clientHistory: ChatHistoryTurnInput[],
    excludeMsgIds: string[]
  ): Array<{ role: string; content: string }> {
    const taskStore = TaskStore.getInstance();
    const tasks = taskStore.listTasks(projectId);
    const taskMap = new Map(tasks.map((t) => [t.taskId, t]));
    const excludeSet = new Set(excludeMsgIds);
    const priorRecords = (this.store.getProject(projectId).chat || []).filter(
      (m) => !excludeSet.has(m.id)
    );

    const formatTaskAnnotation = (taskId: string, ref?: ChatHistoryTaskRef): string => {
      const live = taskMap.get(taskId);
      const stage =
        (live?.result as any)?.currentStage || ref?.stage || 'plan_gdd';
      const status = live?.status || ref?.status || 'unknown';
      const percent = live?.progress?.percent;
      const note = live?.error || live?.progress?.note || ref?.note || '';
      const title = live?.title || ref?.title || '';
      return `\n[关联任务记录 | taskId: ${taskId} | 阶段: ${stage}${title ? ` | 标题: ${title}` : ''} | 状态: ${status}${
        percent !== undefined ? ` | 进度: ${percent}%` : ''
      }${note ? ` | 说明: ${note}` : ''}]`;
    };

    if (clientHistory.length === 0) {
      return priorRecords
        .filter((m) => m.content.trim().length > 0 || Boolean(m.taskRunId))
        .map((m) => ({
          role: m.role,
          content:
            m.content +
            (m.taskRunId
              ? formatTaskAnnotation(m.taskRunId, { stage: m.taskStage })
              : ''),
        }));
    }

    const diskTaskByContent = new Map<string, { taskRunId: string; taskStage?: string }>();
    for (const rec of priorRecords) {
      if (rec.role === 'assistant' && rec.taskRunId && rec.content.trim()) {
        diskTaskByContent.set(rec.content.trim(), {
          taskRunId: rec.taskRunId,
          taskStage: rec.taskStage,
        });
      }
    }

    return clientHistory.map((item) => {
      const taskId =
        item.task?.runId?.trim() ||
        (item.role === 'assistant'
          ? diskTaskByContent.get(String(item.content || '').trim())?.taskRunId
          : undefined);
      const ref: ChatHistoryTaskRef | undefined =
        item.task ||
        (item.role === 'assistant' && item.content
          ? { stage: diskTaskByContent.get(item.content.trim())?.taskStage }
          : undefined);

      return {
        role: item.role,
        content: String(item.content || '') + (taskId ? formatTaskAnnotation(taskId, ref) : ''),
      };
    });
  }

  private async runBackgroundStream(
    stream: ActiveChatStream,
    message: string,
    history: ChatHistoryTurnInput[],
    currentMsgIds: string[] = []
  ): Promise<void> {
    let lastFlushAt = 0;
    let chunkCount = 0;
    let lastSteps: any[] = [];
    const flushToDisk = (status: 'streaming' | 'done' | 'error', finalContent?: string) => {
      if (stream.removed) return;
      this.store.updateChatRecord(stream.projectId, stream.messageId, {
        content: finalContent ?? stream.accumulatedText,
        status,
        ...(status === 'error' && stream.errorMessage
          ? { errorMessage: stream.errorMessage }
          : {}),
        ...(stream.proposal ? { proposal: stream.proposal } : {}),
        ...(stream.task && !stream.task.ownerMessageId
          ? { taskRunId: stream.task.runId, taskStage: stream.task.stage }
          : {}),
      });
      lastFlushAt = Date.now();
    };

    try {
      const turnAbortController = new AbortController();
      stream.abortController = turnAbortController;

      const annotatedHistory = this.buildTaskAwareDialogueHistory(
        stream.projectId,
        history,
        currentMsgIds
      );
      const messages = buildWorkingDialogueTurns(annotatedHistory, message);
      const runtimeCtx: RouterIntentToolContext = {
        projectId: stream.projectId,
        latestUserMessage: message,
        dialogueTurns: messages,
      };

      let lastErr: any;
      let succeeded = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        // 看门狗：上游迟迟不给首字 / 中途卡住，都在这里掐断，避免无限期挂着
        const watchdog = new AbortController();
        let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
        const armWatchdog = (ms: number, reason: string) => {
          if (watchdogTimer) clearTimeout(watchdogTimer);
          watchdogTimer = setTimeout(() => {
            watchdog.abort(new DOMException(reason, 'TimeoutError'));
          }, ms);
          watchdogTimer.unref?.();
        };
        const disarmWatchdog = () => {
          if (watchdogTimer) clearTimeout(watchdogTimer);
          watchdogTimer = undefined;
        };

        try {
          armWatchdog(
            FIRST_TOKEN_TIMEOUT_MS,
            `[ChatStream] 上游 ${FIRST_TOKEN_TIMEOUT_MS}ms 内未返回任何内容`
          );
          const combinedSignal = combineAbortSignals(watchdog.signal, turnAbortController.signal);
          const streamResult = streamRouterDialogue({
            projectId: stream.projectId,
            messages,
            abortSignal: combinedSignal,
          });

          for await (const chunk of streamResult.textStream) {
            stream.lastChunkAt = Date.now();
            armWatchdog(
              STREAM_IDLE_TIMEOUT_MS,
              `[ChatStream] 上游输出中断超过 ${STREAM_IDLE_TIMEOUT_MS}ms`
            );
            chunkCount += 1;
            stream.accumulatedText += chunk;
            this.broadcast(stream, { type: 'text', delta: chunk });
            if (Date.now() - lastFlushAt >= STREAM_FLUSH_INTERVAL_MS) {
              flushToDisk('streaming');
            }
          }

          disarmWatchdog();
          const steps = await streamResult.steps;
          lastSteps = (steps || []) as any[];
          const proposal = extractRouterIntentFromSteps(steps as any, runtimeCtx);
          if (proposal) {
            if (
              proposal.action === 'approve_stage' ||
              proposal.action === 'resume_task'
            ) {
              const startedTask = await this.executeApprovedIntent(stream, proposal);
              if (startedTask) {
                const ownerMessageId =
                  startedTask.ownerMessageId && startedTask.ownerMessageId !== stream.messageId
                    ? startedTask.ownerMessageId
                    : undefined;

                stream.proposal = undefined;
                stream.task = startedTask;
                this.broadcast(stream, {
                  type: 'task',
                  task: startedTask,
                });

                // 意图已经落到任务上：本轮正文只可能是「收到 / 已恢复执行」这类寒暄，
                // 与任务面板（标题 + 进度 + 停止按钮）完全重复，因此一律丢弃。
                stream.accumulatedText = '';
                if (ownerMessageId) {
                  // 任务复用既有气泡：整轮撤销——连同驱动这轮意图的创作者发言一起回收，
                  // 否则会留下一条「继续」孤零零挂在面板下面，没有任何后续回复。
                  stream.removed = true;
                  this.store.deleteChatRecord(stream.projectId, stream.messageId);
                  if (stream.userMessageId) {
                    this.store.deleteChatRecord(stream.projectId, stream.userMessageId);
                  }
                  this.broadcast(stream, {
                    type: 'remove',
                    messageId: stream.messageId,
                    turn: true,
                  });
                } else {
                  // 任务挂在本轮气泡：清空已流出的寒暄，气泡只保留面板
                  this.broadcast(stream, {
                    type: 'snapshot',
                    messageId: stream.messageId,
                    content: '',
                  });
                }
                succeeded = true;
                break;
              }
            }

            stream.proposal = proposal;
            this.broadcast(stream, {
              type: 'proposal',
              proposal,
            });
            // 空正文 / 断流残字的兜底统一放在流结束之后处理，避免两处各补一句。
          }

          // 上游返回「200 但零文本、零意图、零任务」不能算成功：否则会落一条空 assistant
          // 消息并关流，前端只剩一个空气泡，用户永远等不到反馈也看不到错误。
          if (!stream.accumulatedText.trim() && !stream.proposal && !stream.task) {
            throw new Error(
              'No output generated: 上游返回空响应（无文本、无意图），请检查模型配置或稍后重试'
            );
          }

          succeeded = true;
          break;
        } catch (attemptErr: any) {
          disarmWatchdog();
          lastErr = attemptErr;
          const errText = String(attemptErr?.message || '');
          // 看门狗掐断属于网络/网关侧卡死，换一次连接往往就好了，值得重试
          const isWatchdogTimeout =
            watchdog.signal.aborted ||
            errText.includes('未返回任何内容') ||
            errText.includes('输出中断超过');
          const isTransientEmptyResponse =
            isWatchdogTimeout ||
            errText.includes('choices') ||
            errText.includes('InvalidResponseDataError') ||
            errText.includes('No output generated');
          if (
            attempt === 1 &&
            isTransientEmptyResponse &&
            !stream.accumulatedText &&
            !stream.proposal &&
            !stream.task
          ) {
            if (isWatchdogTimeout) {
              console.warn(
                `[ChatStream] 上游疑似卡死（${errText}），换连接重试一次 (projectId=${stream.projectId})`
              );
            }
            console.warn(
              `[ChatStream] 上游返回空响应，正在进行第 2 次安全重试 (projectId=${stream.projectId}): ${errText}`
            );
            continue;
          }
          throw attemptErr;
        }
      }

      if (!succeeded && lastErr) {
        throw lastErr;
      }

      // 写终态前统一兜底：上游断流时 AI SDK 不抛错，textStream 可能只吐出首个 delta。
      // 不重试（重试会再等一整轮超时），直接把提案摘要补进正文并留一条诊断日志。
      const proposalSummary = String(stream.proposal?.summary || '').trim();
      const reply = stream.accumulatedText;
      if (stream.proposal && isTruncatedReply(reply, proposalSummary)) {
        const stepsDiag = lastSteps
          .map((s, i) => `step${i}:finish=${s?.finishReason ?? '?'},textLen=${(s?.text || '').length}`)
          .join(' | ');
        console.warn(
          `[ChatStream] 上游回复疑似断流 (projectId=${stream.projectId}, messageId=${stream.messageId}): ` +
            `chunks=${chunkCount}, 正文=${reply.trim().length}字, 提案摘要=${proposalSummary.length}字; ${stepsDiag}`
        );
        const fallbackText =
          `${reply.trim() ? '\n\n' : ''}[本轮回复中断，以下为本轮提案摘要]\n${proposalSummary}\n\n` +
          '请点击输入框旁的确认按钮启动下一步，或继续补充设定细节。';
        stream.accumulatedText = reply + fallbackText;
        this.broadcast(stream, { type: 'text', delta: fallbackText });
      }

      stream.status = 'done';
      flushToDisk('done');
      this.broadcastDoneAndClose(stream);
    } catch (err: any) {
      const errMsg = err?.message || '总控对话推演异常';
      stream.status = 'error';
      stream.errorMessage = errMsg;
      // 只保留已流出的正文，失败原因单独落字段：前端据此挂带「重试」的提示块，一轮新动作就能摘掉
      flushToDisk('error');
      this.broadcast(stream, { type: 'error', error: errMsg });
      this.broadcastDoneAndClose(stream);
    } finally {
      const timer = setTimeout(() => {
        if (this.streams.get(stream.projectId) === stream) {
          this.streams.delete(stream.projectId);
        }
      }, FINISHED_STREAM_TTL_MS);
      timer.unref?.();
      stream.cleanupTimer = timer;
    }
  }
}
