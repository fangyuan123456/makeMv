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
  accumulatedText: string;
  proposal?: Record<string, any>;
  task?: ActiveChatTask;
  errorMessage?: string;
  status: 'streaming' | 'done' | 'error';
  subscribers: Set<Response>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const STREAM_FLUSH_INTERVAL_MS = 350;
const FINISHED_STREAM_TTL_MS = 60_000;

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
      throw new Error(`[409 Conflict] 项目 [${projectId}] 的总导演正在回复中，请稍候`);
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

    const stream: ActiveChatStream = {
      projectId,
      messageId: placeholder.id,
      accumulatedText: '',
      status: 'streaming',
      subscribers: new Set(),
    };
    this.streams.set(projectId, stream);

    void this.runBackgroundStream(stream, message, history, [userMsg.id, placeholder.id]);
    return stream;
  }

  public subscribe(projectId: string, _req: Request, res: Response): void {
    this.writeSseHeaders(res);
    const active = this.streams.get(projectId);

    if (active) {
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

    // 2. 阶段二推进：若存在挂起于 gdd_approval 的阶段一任务，直接 resume 进入文游装配
    const allTasks = taskStore.listTasks(projectId);
    const suspendedGddTask = [...allTasks]
      .reverse()
      .find(
        (t) =>
          t.status === 'suspended' &&
          (t.result as any)?.pendingApproval?.type === 'gdd_approval'
      );

    if (suspendedGddTask) {
      await ProductionWorkflowEngine.resume(projectId, suspendedGddTask.taskId, {
        approved: true,
      });
      this.store.markTaskNextProposalResolved(projectId, suspendedGddTask.taskId);
      this.store.markChatProposalsResolved(projectId);
      return {
        runId: suspendedGddTask.taskId,
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
    const flushToDisk = (status: 'streaming' | 'done' | 'error', finalContent?: string) => {
      this.store.updateChatRecord(stream.projectId, stream.messageId, {
        content: finalContent ?? stream.accumulatedText,
        status,
        ...(stream.proposal ? { proposal: stream.proposal } : {}),
        ...(stream.task && !stream.task.ownerMessageId
          ? { taskRunId: stream.task.runId, taskStage: stream.task.stage }
          : {}),
      });
      lastFlushAt = Date.now();
    };

    try {
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
        try {
          const streamResult = streamRouterDialogue({
            projectId: stream.projectId,
            messages,
          });

          for await (const chunk of streamResult.textStream) {
            stream.accumulatedText += chunk;
            this.broadcast(stream, { type: 'text', delta: chunk });
            if (Date.now() - lastFlushAt >= STREAM_FLUSH_INTERVAL_MS) {
              flushToDisk('streaming');
            }
          }

          const steps = await streamResult.steps;
          const proposal = extractRouterIntentFromSteps(steps as any, runtimeCtx);
          if (proposal) {
            if (
              proposal.action === 'approve_stage' ||
              proposal.action === 'resume_task'
            ) {
              const startedTask = await this.executeApprovedIntent(stream, proposal);
              if (startedTask) {
                stream.task = startedTask;
                stream.proposal = undefined;
                this.broadcast(stream, {
                  type: 'task',
                  task: startedTask,
                });
                if (!stream.accumulatedText.trim()) {
                  const fallbackText =
                    proposal.action === 'resume_task'
                      ? `收到，已恢复任务 ${startedTask.runId}，继续推进当前阶段流水线，进度将在本消息中实时更新。`
                      : startedTask.stage === 'build_text_game'
                        ? '收到，已批准进入阶段二，即刻为您直接装配可玩互动文游，进度将在本消息中实时更新。'
                        : '收到，已确认立项方向，即刻为您启动全案策划推演，进度将在本消息中实时更新。';
                  stream.accumulatedText = fallbackText;
                  this.broadcast(stream, { type: 'text', delta: fallbackText });
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
            if (!stream.accumulatedText.trim()) {
              const fallbackText =
                '已梳理当前创作构想，请点击输入框旁的确认按钮启动下一步，或继续补充设定细节。';
              stream.accumulatedText = fallbackText;
              this.broadcast(stream, { type: 'text', delta: fallbackText });
            }
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
          lastErr = attemptErr;
          const errText = String(attemptErr?.message || '');
          const isTransientEmptyResponse =
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

      stream.status = 'done';
      flushToDisk('done');
      this.broadcastDoneAndClose(stream);
    } catch (err: any) {
      const errMsg = err?.message || '总控对话推演异常';
      stream.status = 'error';
      stream.errorMessage = errMsg;
      const persistedContent = stream.accumulatedText
        ? `${stream.accumulatedText}\n[导演总控提示: ${errMsg}]`
        : `[导演总控提示: ${errMsg}]`;
      flushToDisk('error', persistedContent);
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
