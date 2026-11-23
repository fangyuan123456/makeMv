/**
 * agents/runtime/runner.ts
 * Agent 对话运行时。
 *
 * 核心架构模式：
 * 1. 物理隔离与单一事实来源 (SSOT)：
 *    按 projectId 与 sessionId 独立管理落盘文件 (server/data/projects/<id>/chat/<sessionId>.json)；
 * 2. 状态原子管理：
 *    提供 getMessages, appendMessage, markProposalsResolved 等原生原子落盘机制；
 * 3. 模板方法模式 (Template Method Pattern)：
 *    基类收敛流式生命周期、时序防御（先落盘用户发言再流式推演）；
 *    派生子类声明 assembleSystemPrompt() 与 getIntentToolSpecs() 完成工序定制与官方意图识别工具挂载。
 */

import { Agent } from '@mastra/core/agent';
import type { CoreMessage } from 'ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { LLMProvider } from '../../llm/index.js';
import {
  buildMultimodalUserContent,
  resolveVisionImages,
  type ResolvedVisionImage,
  type VisionImageRef,
} from '../../llm/vision-perception.js';
import { config } from '../../utils/config.js';
import { buildWorkingDialogueTurns, streamAgentWithCompat } from '../../mastra-compat/streamAgent.js';
import { TaskStore } from '../../task-engine/task-store.js';
import { renderProjectStaleSummary } from '../../project-store/freshness.js';
import { JsonStreamStringExtractor } from '../../utils/JsonStreamStringExtractor.js';
import { AgentSessionStore } from './session-store.js';
import { approveProposal as approveSavedProposal } from './approval-service.js';
import { createIntentTools, EMIT_DIRECTOR_INTENT_TOOL_NAME } from './intent-tool.js';
import { DirectorIntentResolver } from './intent-resolver.js';
import { IntentPolicy } from './intent-policy.js';
import { IntentRepairEngine } from './intent-repair.js';
import { mergeStreamedAndToolReply, sanitizeAssistantSpeech } from './stream-merger.js';
import { renderViewportContextSection } from './viewport-observer.js';
import { inspectSessionState } from './session-state-inspector.js';
import {
  renderPipelineSopGuidance,
  type PipelineStageSpec,
} from './pipeline.js';
import type {
  ConversationMessage,
  ParsedIntentResult,
  AgentStreamOptions,
  AgentFocusContext,
  SubmittableToolSpec,
  SessionActionIntent,
} from './types.js';
import type { TaskRecord } from '../../task-engine/types.js';

export { mergeStreamedAndToolReply, sanitizeAssistantSpeech } from './stream-merger.js';

export interface AgentRunnerOptions {
  projectId: string;
  sessionId: string;
}

interface TurnIntentContext {
  isSystemTrigger: boolean;
  pendingProposalId: string | null;
  pendingProposalSnapshot: string | null;
}

export abstract class AgentRunner<TIntent = any> {
  public readonly projectId: string;
  public readonly sessionId: string;
  protected readonly sessionStore: AgentSessionStore<TIntent>;

  constructor(options: AgentRunnerOptions) {
    if (!options.projectId) {
      throw new Error('[AgentRunner] 缺少有效 projectId');
    }
    if (!options.sessionId) {
      throw new Error('[AgentRunner] 缺少有效 sessionId');
    }

    this.projectId = options.projectId;
    this.sessionId = options.sessionId;

    this.sessionStore = new AgentSessionStore<TIntent>(this.projectId, this.sessionId);
  }

  public getMessages(): ConversationMessage<TIntent>[] {
    return this.sessionStore.getMessages();
  }

  public appendMessage(
    record: Partial<ConversationMessage<TIntent>> & { role: 'user' | 'assistant' | 'system'; content: string },
    resolveProposals?: boolean
  ): ConversationMessage<TIntent> {
    return this.sessionStore.appendMessage(record, resolveProposals);
  }

  /** 批准按钮绑定具体提案，由服务端原子确认并生成任务消息。 */
  public approveProposal(proposalId: string): ParsedIntentResult<TIntent> {
    return approveSavedProposal(this.sessionStore, proposalId, () =>
      this.resolveDirectorIntent({ action: 'approve' }) as SessionActionIntent
    );
  }

  public markProposalsResolved(): void {
    this.sessionStore.markProposalsResolved();
  }

  public updateMessage(messageId: string, patch: Partial<ConversationMessage<TIntent>>): void {
    this.sessionStore.updateMessage(messageId, patch);
  }

  public clearMessages(): void {
    this.sessionStore.clearMessages();
  }

  /**
   * 模板方法：流式推演驱动流
   * 1. 首跳先行落盘用户发言（源头治理，绝不在流式中断时丢消息）；
   * 2. 调用子类 assembleSystemPrompt() 组装专业人设与工序看板；
   * 3. 驱动 streamText 输出；
   * 4. 捕获模型触发的真 Tool Call 并结构化转化为 Pending 提案卡片。
   */
  public async stream(options: AgentStreamOptions<TIntent>): Promise<ParsedIntentResult<TIntent>> {
    const { message, attachments, focus, isSystemTrigger, abortSignal, onTextChunk, onDone, onError } = options;
    const pendingAtStart = [...this.getMessages()].reverse().find(m => m.proposal && !m.proposalResolved);
    // 每次调用独立持有快照，不能放在实例字段中被并行会话覆盖。
    const turn: TurnIntentContext = {
      isSystemTrigger: Boolean(isSystemTrigger),
      pendingProposalId: pendingAtStart?.id || null,
      pendingProposalSnapshot: pendingAtStart ? JSON.stringify(pendingAtStart.proposal) : null,
    };
    const resolveTurnIntent = (args: any) => this.resolveDirectorIntent(args, turn);

    // 1. 用户发言首跳立即刚性落盘（含图片附件，绝不在流式中断时丢消息）
    if (!isSystemTrigger) {
      this.appendMessage({
        role: 'user',
        content: message,
        ...(attachments?.length ? { attachments } : {}),
      });
    }

    try {
      // 2. 调用子类实现的抽象钩子装配业务层 System Prompt，并挂载工序能力编目与置底意图漏斗
      if (focus?.location) {
        console.log(
          `[AgentRunner:${this.sessionId}] 视口焦点:`,
          JSON.stringify({ location: focus.location, target: focus.target || null })
        );
      }
      const systemPrompt = await this.buildFullSystemPrompt();

      // 合并「创作者本轮发送的图片（最高优先级）」与「当前视口焦点可见图片」统一送入通用视觉感知层
      const attachmentImageRefs: VisionImageRef[] = (attachments || []).map((att, idx) => ({
        mediaUrl: att.url,
        label: att.name || `聊天图片 ${idx + 1}`,
        role: '创作者本轮发送图片',
        note: `本地路径: ${att.url}`,
      }));
      const viewportImageRefs: VisionImageRef[] =
        !isSystemTrigger && focus?.location?.trim()
          ? await this.resolveFocusImages(focus, { hasAttachments: attachmentImageRefs.length > 0 })
          : [];
      const focusImages: ResolvedVisionImage[] = !isSystemTrigger
        ? resolveVisionImages(this.projectId, [...attachmentImageRefs, ...viewportImageRefs])
        : [];

      const extraDetails = !isSystemTrigger && focus
        ? await this.resolveFocusDetails(focus, { abortSignal })
        : [];
      const focusSection = isSystemTrigger
        ? ''
        : await renderViewportContextSection({
            projectId: this.projectId,
            focus,
            userMessage: message,
            attachments,
            images: focusImages,
            extraDetails,
            abortSignal,
          });

      // 3. 构建干净纯粹的多轮对白上下文 (真实任务状态由 System Prompt 的 State Board 统一提供，杜绝历史投毒)
      const serverMessages = this.getMessages();

      const effectiveHistory = serverMessages.map((m) => ({
        role: m.role,
        content: m.postSummarySpeech || m.content || '',
      }));

      const workingMessages: CoreMessage[] = buildWorkingDialogueTurns(effectiveHistory, message, 12);

      // 仅在发往大模型的当前轮内存态 user 消息前挂载挂起待审信封、实时视口焦点与多模态图像（绝不污染落盘历史）
      if (!isSystemTrigger && workingMessages.length > 0) {
        const lastTurn = workingMessages[workingMessages.length - 1];
        if (lastTurn.role === 'user' && typeof lastTurn.content === 'string') {
          let injectedPrefix = '';
          if (pendingAtStart?.proposal) {
            const p = pendingAtStart.proposal as any;
            const title = p.title || p.tool || '待审制片工序方案';
            const opsCount = Array.isArray(p.operations) && p.operations.length > 0 ? p.operations.length : 1;
            const desc = p.description ? `\n- 方案内容: ${p.description}` : '';
            injectedPrefix += `<pending_proposal_context>\n【当前会话挂起待审卡片】：${title}（共 ${opsCount} 步）${desc}\n- 刚性裁决指引：创作者当前回复若为纯肯定、赞同或授权口令（如“同意/好的/开跑/行/可以/按这个来/确认”等），代表全权授权此方案开跑，必须且唯一调用 emit_director_intent(action: "approve") 授权执行，严禁重复出卡；若提出明确修改意见则调用 modify/propose；若纯犹豫/叫停用 chat_only。\n</pending_proposal_context>\n\n`;
          }
          if (focusSection) {
            injectedPrefix += `<current_viewport_focus>\n${focusSection}\n</current_viewport_focus>\n\n`;
          }
          const nextText = injectedPrefix ? `${injectedPrefix}${lastTurn.content}` : lastTurn.content;
          lastTurn.content =
            config.llm.supportsVision && focusImages.length > 0
              ? buildMultimodalUserContent(nextText, focusImages)
              : nextText;
        }
      }

      const tools = this.buildDefaultTools(Boolean(isSystemTrigger), Boolean(pendingAtStart));
      const effectiveSystemPrompt =
        isSystemTrigger && !tools
          ? `${systemPrompt}\n\n【当前为纯文本阶段复盘模式】：本次无需调用任何工具，也无需发起新提案，请直接以自然语言完整输出专业复盘正文。`
          : isSystemTrigger && pendingAtStart
            ? `${systemPrompt}\n\n本轮是自动复盘，已有待审方案。只汇报已记录的任务事实，使用 chat_only；不得替换、修改、批准或作废待审卡片。`
            : systemPrompt;
      const agent = new Agent({
        name: `${this.sessionId}-director`,
        instructions: effectiveSystemPrompt,
        model: LLMProvider.getModel(),
        tools: tools || {},
      });
      const result = streamAgentWithCompat(agent, workingMessages, {
        maxSteps: 1,
        ...(tools ? { toolChoice: 'required' as const } : {}),
        experimentalToolCallStreaming: true,
        abortSignal,
      });

      let fullRawText = '';
      let streamedReplyText = '';
      const streamedOutputSource: { current: 'text' | 'tool' | null } = { current: null };

      const extractor = new JsonStreamStringExtractor({
        targetKeys: ['reply'],
        onChunk: (chunk) => {
          streamedReplyText += chunk;
          if (streamedOutputSource.current === null) streamedOutputSource.current = 'tool';
          if (streamedOutputSource.current === 'tool') {
            onTextChunk?.(chunk);
          }
        },
      });

      // 同时消费文本增量与工具事件。开启 experimental_toolCallStreaming 后支持提取工具参数流。
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          fullRawText += part.textDelta;
          if (streamedOutputSource.current === null && part.textDelta) streamedOutputSource.current = 'text';
          if (streamedOutputSource.current === 'text') onTextChunk?.(part.textDelta);
        } else if (part.type === 'tool-call-delta' && (part as any).argsTextDelta) {
          extractor.feed((part as any).argsTextDelta);
        }
      }

      // 4. 原生 Tool Call 拦截与转译（人在回路切面）：
      // 若大模型在推演中触发了官方意图工具，系统拦截该调用并结构化转化为 Pending 状态的 ActionProposal 实体卡片
      let capturedIntent: TIntent | null = null;
      let rawToolReply = '';

      if (tools) {
        let failedArgs: any = undefined;
        try {
          const toolCalls = await result.toolCalls;
          if (Array.isArray(toolCalls) && toolCalls.length > 0) {
            const activeCall = toolCalls[0];
            if (activeCall.toolName === EMIT_DIRECTOR_INTENT_TOOL_NAME) {
              failedArgs = activeCall.args;
              if (typeof activeCall.args?.reply === 'string') {
                rawToolReply = activeCall.args.reply;
              }
              capturedIntent = resolveTurnIntent(activeCall.args);
            }
          }
          if (!capturedIntent) throw new Error('未收到有效的导演意图，未启动任务');
        } catch (toolCallErr: any) {
          const errMsg = toolCallErr?.message || String(toolCallErr);
          console.warn(
            `[AgentRunner:${this.sessionId}] 解析 toolCalls 异常: ${errMsg}`,
            JSON.stringify({
              action: failedArgs?.action,
              tool: failedArgs?.tool || failedArgs?.targetTool,
              operationsCount: Array.isArray(failedArgs?.operations) ? failedArgs.operations.length : 0,
              argKeys: failedArgs && typeof failedArgs === 'object' ? Object.keys(failedArgs) : [],
            })
          );
          const existingSpeech = (rawToolReply || streamedReplyText || fullRawText || '').trim();
          if (isSystemTrigger) {
            const summaryError = new Error(`复盘或后续提案生成失败，已记录的任务执行结果未改变：${errMsg}`);
            onTextChunk?.(`\n\n更正：${summaryError.message}`);
            throw summaryError;
          }

          let finalErrMsg = errMsg;
          if (!capturedIntent && !abortSignal?.aborted) {
            try {
              const repaired = await this.repairInvalidIntentCall({
                agent,
                workingMessages,
                existingSpeech,
                errorMessage: errMsg,
                abortSignal,
                resolveIntent: resolveTurnIntent,
              });
              if (repaired?.intent) {
                const repairedIntent = repaired.intent as unknown as SessionActionIntent;
                const repairedAction = repairedIntent.action;
                const reply = repairedAction === 'approve'
                  ? '方案校验已恢复，已确认待审方案，接下来调度执行。'
                  : repairedAction === 'chat_only'
                    ? `本轮操作未启动。${repairedIntent.reply || repaired.reply || '请补充要求后重试。'}`
                    : '方案已修正，尚未启动。请审阅新的待确认方案。';
                capturedIntent = { ...repaired.intent, reply, replyOverride: true } as TIntent;
              }
            } catch (repairErr: any) {
              finalErrMsg = repairErr?.message || errMsg;
              console.warn(`[AgentRunner:${this.sessionId}] 静默自愈纠偏失败:`, finalErrMsg);
            }
          }
          if (!capturedIntent) {
            capturedIntent = {
              action: 'chat_only',
              replyOverride: true,
              reply: '本轮操作未启动：方案解析或校验失败，自动修复未成功。此前的开跑表述不生效，请重试或调整要求。',
            } as TIntent;
          }
        }
      }

      // 5. 组装纯净的流式推演结果与人在回路提案（合并自然语言流与 tool.reply，彻底消灭吞字）
      const merged = mergeStreamedAndToolReply({
        streamedOutputSource: streamedOutputSource.current,
        fullRawText,
        streamedReplyText,
        toolReply: rawToolReply || String((capturedIntent as any)?.reply || ''),
      });
      let effectiveText = merged.finalText;
      // 门禁拒绝执行时，解释以代码返回的原因而非模型原先的开跑对白为准。
      if ((capturedIntent as any)?.action === 'chat_only' && (capturedIntent as any)?.reply &&
        (capturedIntent as any).reply !== rawToolReply) {
        (capturedIntent as any).replyOverride = true;
      }
      if ((capturedIntent as any)?.replyOverride) {
        effectiveText = String((capturedIntent as any).reply || '').trim();
        // 增量已发出后无法撤回；立即追加纠正，最终消息以 cleanText 覆盖落盘。
        onTextChunk?.(`${fullRawText || streamedReplyText ? '\n\n更正：' : ''}${effectiveText}`);
      } else if (merged.appendChunk) {
        onTextChunk?.(merged.appendChunk);
      }

      // 反事实文本净化门禁：当行动是 approve 授权开跑时，物理算力即将启动，尚未落盘，绝对严禁宣称已物理落盘！
      if ((capturedIntent as any)?.action === 'approve') {
        effectiveText = effectiveText.trim();
      }

      if (!effectiveText && capturedIntent) {
        const intentObj = capturedIntent as any;
        const actTitle = intentObj.title || '制片工序';
        if (intentObj.action === 'approve') {
          effectiveText = `**授权确认，开跑。**\n\n方案已锁定，我现在授权启动【${actTitle}】工序，正在调度物理引擎落盘。`;
        } else {
          effectiveText =
            intentObj.description ||
            `已为您出具【${actTitle}】方案，请创作者审阅。`;
        }
      }

      effectiveText = sanitizeAssistantSpeech(effectiveText);

      // 刚性源头防御：若无有效正文且无有效意图，阻断空消息生成与入库，杜绝幽灵圆圈
      if (!effectiveText && !capturedIntent) {
        const emptyResult: ParsedIntentResult<TIntent> = {
          cleanText: '',
          intent: null,
        };
        await onDone?.(emptyResult);
        return emptyResult;
      }

      const visibleIntent = (capturedIntent as any)?.action === 'chat_only' ? null : capturedIntent;
      const parsed: ParsedIntentResult<TIntent> = {
        cleanText: effectiveText,
        intent: visibleIntent,
      };

      // 6. 若指定 targetMessageId，则将复盘对白与意图提案直接追加合并入该任务消息中，同 taskId 统一收敛
      const isAlreadyApproved = (parsed.intent as any)?.action === 'approve';

      if (options.targetMessageId) {
        const existingMessages = this.getMessages();
        let target = existingMessages.find((m) => m.id === options.targetMessageId);
        if (!target && options.targetMessageId.startsWith('msg_task_')) {
          const tid = options.targetMessageId.replace(/^msg_task_/, '');
          target = existingMessages.find((m) => m.taskId === tid);
        }
        if (!target) {
          target = existingMessages.find((m) => m.taskId === options.targetMessageId);
        }
        if (!target) throw new Error(`未找到复盘目标消息: ${options.targetMessageId}`);
        const targetId = target.id;
        const isPlanMessage = Array.isArray(target.planSteps) && target.planSteps.length > 0;
        this.updateMessage(targetId, {
          // 结构化落盘：独立保存阶段复盘对白，绝不用 --- 污染 content
          postSummarySpeech: parsed.cleanText,
          ...(target.content ? {} : { content: parsed.cleanText }),
          ...(isPlanMessage
            ? {}
            : {
                taskStatus: 'completed',
                taskProgress: { percent: 100, message: '推演完成' },
              }),
          metadata: { ...target?.metadata, summaryStatus: 'completed' },
        });
        parsed.messageId = targetId;

        // 若复盘推演产出了合法的下游行动提案（propose），直接将其挂载入该任务消息中，同 taskId 统一收敛，消灭多余气泡
        if ((parsed.intent as any)?.action === 'propose') {
          const cleanMetadata = { ...(target?.metadata || {}) };
          delete cleanMetadata.approvedProposalId;
          this.updateMessage(targetId, {
            proposal: parsed.intent || undefined,
            proposalResolved: false,
            metadata: cleanMetadata,
          });
          parsed.messageId = targetId;
        }
      } else {
        const isApprove = (parsed.intent as any)?.action === 'approve';
        const savedEntry = this.appendMessage({
          role: 'assistant',
          content: parsed.cleanText,
          leadInSpeech: isApprove ? parsed.cleanText : undefined,
          proposal: parsed.intent || undefined,
          proposalResolved: isAlreadyApproved ? true : false,
          ...(isApprove && turn.pendingProposalId ? { metadata: { approvedProposalId: turn.pendingProposalId } } : {}),
        });
        if (isApprove && turn.pendingProposalId) {
          this.updateMessage(turn.pendingProposalId, { proposalResolved: true });
        }
        parsed.messageId = savedEntry.id;
      }

      await onDone?.(parsed);
      return parsed;
    } catch (err: any) {
      if (isSystemTrigger && options.targetMessageId) {
        const target = this.getMessages().find(m => m.id === options.targetMessageId);
        if (target) this.updateMessage(target.id, {
          metadata: { ...target.metadata, summaryStatus: 'failed', summaryError: err?.message || String(err) },
        });
      }
      console.error(`[AgentRunner:${this.sessionId}] 流式推演失败:`, err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  /**
   * 基类统一装配的完整全局 System Prompt（业务人设 SOP + 实时制片态势 + 遗留校验 + 能力编目 + P0置底意图漏斗）
   */
  public async buildFullSystemPrompt(): Promise<string> {
    const baseSystemPrompt = await this.assembleSystemPrompt();
    const sessionStateSection = this.renderSessionStateSection();
    const staleDataSection = renderProjectStaleSummary(this.projectId);
    const toolsCatalog = this.renderDynamicToolsCatalog();
    const funnelSection = AgentRunner.renderFunnelPromptMatrix();
    return [baseSystemPrompt, sessionStateSection, staleDataSection, toolsCatalog, funnelSection]
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * 业务子类必须实现的 System Prompt 装配逻辑（注入专属 SOP 状态机、人设、制片规则）
   */
  protected abstract assembleSystemPrompt(): string | Promise<string>;

  /**
   * 可选扩展钩子：子类可按聚焦目标从项目黑板反查业务详情行，基类会自动拼入通用视口焦点区块。
   * 不覆写时仍开箱支持基础位置与聚焦目标感知。
   */
  protected resolveFocusDetails(
    _focus: AgentFocusContext,
    _ctx?: { abortSignal?: AbortSignal }
  ): string[] | Promise<string[]> {
    return [];
  }

  /**
   * 通用多模态视觉钩子：任意子类 Agent 声明当前视口相关的可见图片清单（单图或多图），
   * 基类自动按配置走「原生多模态直传」或「通用 VLM 视觉感知」，开箱服务审美、细节、构图、比对与改图等全场景。
   */
  protected resolveFocusImages(
    _focus: AgentFocusContext,
    _ctx?: { hasAttachments?: boolean }
  ): VisionImageRef[] | Promise<VisionImageRef[]> {
    return [];
  }

  /**
   * 统一会话提案与物理任务态势摘要（SSOT）
   * 委托给 session-state-inspector 巡检模块
   */
  protected renderSessionStateSection(): string {
    if (this.getIntentToolSpecs().length === 0) return '';
    return inspectSessionState({
      projectId: this.projectId,
      sessionId: this.sessionId,
      messages: this.getMessages(),
    });
  }

  /**
   * 统一工程上下游资产脏数据态势感知（Stale Data SSOT）
   * 委托给 project-store/freshness 统一黑板渲染，零子类工具名硬编码
   */
  protected renderStaleDataSection(): string {
    return renderProjectStaleSummary(this.projectId);
  }

  /**
   * 业务子类声明支持的合法物理工序工具规范清单 (SSOT)
   * 基类基于此清单自动组装官方 emit_director_intent 意图识别工具
   */
  protected getIntentToolSpecs(): SubmittableToolSpec[] {
    return [];
  }

  /**
   * 业务工序流水线阶段顺位 (Pipeline Stages SSOT)
   * 默认直接从 getIntentToolSpecs() 动态能力编目派生，子类 0 重复声明；
   * 底层微内核自动完成顺位推导、实体透传与卡片调度
   */
  protected getPipelineStageSequence(): PipelineStageSpec[] {
    const specs = this.getIntentToolSpecs();
    return specs.map((s) => ({
      tool: s.toolName,
      stageName: s.stageName || s.title,
      description: s.description,
      targetKind: s.targetKind,
    }));
  }

  /**
   * 统一任务落盘事件驱动：注入执行顺序与通用推演铁律，由大模型自主推演下一步
   */
  public getPostTaskPrompt(task: TaskRecord, title: string): string {
    const stages = this.getPipelineStageSequence();
    if (stages.length > 0) {
      return renderPipelineSopGuidance(stages, task, title);
    }

    return `【制片工序事件】工序【${title || task.toolName}】已完成并物理落盘。\n【复盘职责】：请核对当前项目资产黑板，向创作者简要复盘实际成果与细节（以自然语言总结，若无明确物理工序推进则以 chat_only 收官，严禁发起阶段之外的提议）。`;
  }

  public getPostPlanPrompt(
    planTitle: string,
    steps: Array<{ title: string; tool: string; status: string; durationMs?: number; error?: string }>
  ): string {
    const succeeded = steps.filter((s) => s.status === 'completed');
    const failed = steps.filter((s) => s.status === 'failed');
    const cancelled = steps.filter((s) => s.status === 'cancelled');
    const lines = steps.map((s, i) => {
      const sec = s.durationMs ? ` (${(s.durationMs / 1000).toFixed(1)}s)` : '';
      const statusText =
        s.status === 'completed'
          ? `完成${sec}`
          : s.status === 'failed'
          ? `失败: ${s.error || '未知错误'}`
          : s.status === 'cancelled'
          ? '已取消'
          : s.status;
      return `${i + 1}. ${s.title} [${statusText}]`;
    });
    return `【制片计划执行完毕】多步计划【${planTitle}】已全部结束（成功 ${succeeded.length}/${steps.length}，失败 ${failed.length}，取消 ${cancelled.length}）：
${lines.join('\n')}
请核对当前最新项目资产，用简练清晰的中文向创作者做整体汇总复盘。仅报告任务记录支持的状态和产物；本轮未提供生成图片或视频，不得评价实际画面或声称已完成视觉验收。区分成功、失败和取消，不将计划结束等同于全部成功。
【通用行动提案（提议即卡片）】：若计划执行后产生了新的下游待处理工序或遗留脏数据，必须直接调用 emit_director_intent(action: "propose", ...) 抛出下一步待审方案卡片供一键批准。面向创作者的发言（reply）必须明确说明“方案卡片已生成，请审阅授权”，严禁用“我建议/是否需要”等商量式反问句推卸卡片事实，确保创作者回复“同意”时能够清晰映射到卡片授权；若全链路已收敛则出具 chat_only。`;
  }

  public buildPlanSummaryFallback(
    planTitle: string,
    steps: Array<{ title: string; tool: string; status: string; durationMs?: number; error?: string }>
  ): string {
    const succeeded = steps.filter((s) => s.status === 'completed');
    const failed = steps.filter((s) => s.status === 'failed');
    const cancelled = steps.filter((s) => s.status === 'cancelled');

    const lines = steps.map((s, i) => {
      const sec = s.durationMs ? ` (${(s.durationMs / 1000).toFixed(1)}s)` : '';
      const statusText =
        s.status === 'completed'
          ? `✓ 已完成${sec}`
          : s.status === 'failed'
          ? `✕ 失败: ${s.error || '执行异常'}`
          : s.status === 'cancelled'
          ? '⏹ 已取消'
          : s.status;
      return `${i + 1}. **${s.title}** · ${statusText}`;
    });

    let conclusion = `【${planTitle}】执行完毕：成功 ${succeeded.length}/${steps.length} 项`;
    if (failed.length > 0) conclusion += `，失败 ${failed.length} 项`;
    if (cancelled.length > 0) conclusion += `，取消 ${cancelled.length} 项`;
    conclusion += '。';

    if (failed.length > 0) {
      conclusion += '\n\n部分工序执行受阻，请根据上方清单排查原因，可直接点击单步旁边的【重试】或告知我重新编排。';
    } else {
      conclusion += '\n\n全量资产已完成物理落盘并与工程黑板完成同步，可继续推进后续工序。';
    }

    return `${conclusion}\n\n${lines.join('\n')}`;
  }

  protected hasPendingProposal(): boolean {
    return this.getMessages().some((m) => Boolean(m.proposal && !m.proposalResolved));
  }

  /**
   * 当大模型首次调用 emit_director_intent 因漏填 targetTool 或参数缺失触发门禁拦截时，
   * 静默发起 1 次结构化自愈重试（不向前端重复推送流式文本），避免“嘴上说确认后即开跑、卡片却缺失”。
   */
  protected async repairInvalidIntentCall(ctx: {
    agent: Agent;
    workingMessages: CoreMessage[];
    existingSpeech: string;
    errorMessage: string;
    abortSignal?: AbortSignal;
    resolveIntent?: (args: any) => any;
  }): Promise<{ intent: TIntent; reply?: string } | null> {
    return IntentRepairEngine.repair({
      sessionId: this.sessionId,
      agent: ctx.agent,
      workingMessages: ctx.workingMessages,
      existingSpeech: ctx.existingSpeech,
      errorMessage: ctx.errorMessage,
      resolveIntent: ctx.resolveIntent || ((args) => this.resolveDirectorIntent(args)),
      abortSignal: ctx.abortSignal,
    });
  }

  /**
   * 基类统一装配的官方人在回路意图识别器 (Intent Resolver Tool)
   * 严格内聚【自顶向下 P0 ➔ P5 多层意图决策漏斗】
   */
  protected buildDefaultTools(isSystemTrigger = false, hasPendingProposal = this.hasPendingProposal()): Record<string, any> | undefined {
    return createIntentTools(
      this.getIntentToolSpecs(),
      isSystemTrigger,
      hasPendingProposal
    );
  }

  /**
   * 生成标准化的意图决策微内核规约 (高信噪比 SSOT: 统一由 IntentPolicy 单一事实来源驱动)
   */
  public static renderFunnelPromptMatrix(): string {
    return IntentPolicy.renderFunnelMatrix();
  }

  /**
   * 基于 getIntentToolSpecs() 动态反射生成可用工序能力编目 (Dynamic Tools Catalog SSOT)
   * 彻底实现：工具定义为单一事实来源，外部业务提示词零硬编码工具名与参数说明
   */
  public renderDynamicToolsCatalog(): string {
    const specs = this.getIntentToolSpecs();
    if (!specs || specs.length === 0) {
      return '';
    }

    const lines = specs.map((s, index) => {
      let schemaText = '';
      try {
        const jsonSchema = zodToJsonSchema(s.schema as any) as any;
        if (jsonSchema?.properties) {
          const props = Object.entries(jsonSchema.properties)
            .filter(([k]) => k !== 'projectId') // projectId 由系统自动注入，无需占用模型注意力
            .map(([k, v]: [string, any]) => {
              const isReq = Array.isArray(jsonSchema.required) && jsonSchema.required.includes(k);
              const desc = v?.description ? ` (${v.description})` : '';
              const enumVals = Array.isArray(v?.enum) ? ` [可选: ${v.enum.join(' | ')}]` : '';
              return `     * ${k}${isReq ? ' (必填)' : ' (可选)'}: ${v?.type || 'any'}${enumVals}${desc}`;
            });
          schemaText = `   - 参数规约 (params):\n${props.join('\n')}`;
        } else {
          schemaText = `   - input schema:\n${JSON.stringify(jsonSchema, null, 2)}`;
        }
      } catch {
        schemaText = '   - input schema: 未提供结构化 schema';
      }
      return `${index + 1}. 【${s.title}】(tool: "${s.toolName}")\n   - 功能与产出: ${s.description}\n${schemaText}`;
    });

    return `### 【当前工序阶段可用能力编目】
从以下法定编目中选取匹配当前业务目标的 tool 发起方案：
${lines.join('\n')}`;
  }

  /**
   * 将大模型触发的 emit_director_intent 意图识别调用解析为规范的 SessionActionIntent
   * 委托给独立的 DirectorIntentResolver 处理客观门禁与类型校验 (SSOT)
   */
  protected resolveDirectorIntent(args: any, turn?: TurnIntentContext): any {
    const messages = this.getMessages();
    const lastPendingMsg = [...messages].reverse().find((m) => m.proposal && !m.proposalResolved);
    const pendingProposal = lastPendingMsg?.proposal as any;
    const blocked = (reply: string) => ({ action: 'chat_only', title: '', params: {}, reply, replyOverride: true });
    if (turn?.isSystemTrigger) {
      if (args?.action === 'approve' || args?.action === 'modify' || args?.invalidatePendingProposal === true) {
        return blocked('自动复盘不改变待审方案，也不授权执行。已有任务结果保持不变。');
      }
      if (args?.action === 'propose' && (turn.pendingProposalId || lastPendingMsg)) {
        return blocked('已有待审方案，本次复盘不另建或替换卡片。已有任务结果保持不变。');
      }
    } else if (turn && (args?.action !== 'chat_only' || args?.invalidatePendingProposal === true)) {
      if ((lastPendingMsg?.id || null) !== turn.pendingProposalId ||
        (lastPendingMsg ? JSON.stringify(lastPendingMsg.proposal) : null) !== turn.pendingProposalSnapshot) {
        return blocked('待审方案已变化，本轮未批准或修改任何方案。请查看最新卡片后重新确认。');
      }
    }
    try {
      return DirectorIntentResolver.resolve({
        args,
        projectId: this.projectId,
        specs: this.getIntentToolSpecs(),
        pendingProposal,
        clipId: (this as any).clipId,
        sessionId: this.sessionId,
      });
    } finally {
      // 已识别替换诉求时，即使新方案校验失败，旧方案也不能继续获批。
      // 按消息 ID 关闭本次读取的提案，避免误关并发写入的新卡片。
      if (!turn?.isSystemTrigger && lastPendingMsg && (args?.action === 'propose' || args?.action === 'modify' ||
        (args?.action === 'chat_only' && args.invalidatePendingProposal === true))) {
        this.updateMessage(lastPendingMsg.id, { proposalResolved: true });
        if (turn) {
          turn.pendingProposalId = null;
          turn.pendingProposalSnapshot = null;
        }
      }
    }
  }
}
