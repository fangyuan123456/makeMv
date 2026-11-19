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
  perceiveVisualContext,
  resolveVisionImages,
  type ResolvedVisionImage,
  type VisionImageRef,
} from '../../llm/vision-perception.js';
import { config } from '../../utils/config.js';
import { buildWorkingDialogueTurns, streamAgentWithCompat } from '../../mastra-compat/streamAgent.js';
import { TaskStore } from '../../task-engine/task-store.js';
import { JsonStreamStringExtractor } from '../../utils/JsonStreamStringExtractor.js';
import { AgentSessionStore } from './session-store.js';
import { approveProposal as approveSavedProposal } from './approval-service.js';
import { createIntentTools, EMIT_DIRECTOR_INTENT_TOOL_NAME } from './intent-tool.js';
import type {
  ConversationMessage,
  ParsedIntentResult,
  AgentStreamOptions,
  AgentFocusContext,
  SubmittableToolSpec,
  SessionActionIntent,
} from './types.js';
import type { TaskRecord } from '../../task-engine/types.js';

export interface AgentRunnerOptions {
  projectId: string;
  sessionId: string;
}

/**
 * 合并自然语言流 (text-delta) 与意图工具参数流 (emit_director_intent.reply)，
 * 彻底杜绝模型“先说过渡开场白 + 再把完整正文写入 tool.reply”时正文被静默吞掉的问题。
 */
export function mergeStreamedAndToolReply(params: {
  streamedOutputSource: 'text' | 'tool' | null;
  fullRawText: string;
  streamedReplyText: string;
  toolReply: string;
}): { finalText: string; appendChunk: string } {
  const raw = params.fullRawText.trim();
  const reply = (params.toolReply || params.streamedReplyText || '').trim();

  if (params.streamedOutputSource === 'tool') {
    const finalText = reply || raw;
    const streamed = params.streamedReplyText;
    const appendChunk =
      finalText && streamed && finalText.startsWith(streamed) && finalText.length > streamed.length
        ? finalText.slice(streamed.length)
        : '';
    return { finalText, appendChunk };
  }

  if (params.streamedOutputSource === 'text') {
    if (!reply || reply === raw || raw.includes(reply)) {
      return { finalText: raw, appendChunk: '' };
    }
    if (reply.startsWith(raw)) {
      return { finalText: reply, appendChunk: reply.slice(raw.length) };
    }
    const idx = reply.indexOf(raw);
    if (idx > 0) {
      return { finalText: reply, appendChunk: reply.slice(idx + raw.length) };
    }
    const separator = '\n\n';
    return { finalText: `${raw}${separator}${reply}`, appendChunk: `${separator}${reply}` };
  }

  const finalText = reply || raw;
  return { finalText, appendChunk: finalText };
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

    // 1. 用户发言首跳立即刚性落盘（含图片附件，绝不在流式中断时丢消息）
    if (!isSystemTrigger) {
      this.appendMessage({
        role: 'user',
        content: message,
        ...(attachments?.length ? { attachments } : {}),
      });
    }

    try {
      // 2. 调用子类实现的抽象钩子装配业务层 System Prompt，并挂载工序能力编目
      if (focus?.location) {
        console.log(
          `[AgentRunner:${this.sessionId}] 视口焦点:`,
          JSON.stringify({ location: focus.location, target: focus.target || null })
        );
      }
      const baseSystemPrompt = await this.assembleSystemPrompt();
      const sessionStateSection = this.renderSessionStateSection();

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

      const focusSection = isSystemTrigger
        ? ''
        : await this.renderFocusContextSection(focus, {
            userMessage: message,
            attachments,
            images: focusImages,
            abortSignal,
          });
      const toolsCatalog = this.renderDynamicToolsCatalog();
      const systemPrompt = [baseSystemPrompt, sessionStateSection, toolsCatalog]
        .filter(Boolean)
        .join('\n\n');

      // 3. 构建干净纯粹的多轮对白上下文 (真实任务状态由 System Prompt 的 State Board 统一提供，杜绝历史投毒)
      const serverMessages = this.getMessages();

      const effectiveHistory = serverMessages.map((m) => {
        let content = m.content || '';
        // 历史任务已完成消息清洗：提取真正的成果复盘部分，剥离中间态的'收到开跑'过程词，彻底消除大模型模仿连体格式偏置
        if (m.role === 'assistant' && content.includes('\n\n---\n\n')) {
          const parts = content.split('\n\n---\n\n');
          content = parts[parts.length - 1].trim();
        }
        return {
          role: m.role,
          content,
        };
      });

      const workingMessages: CoreMessage[] = buildWorkingDialogueTurns(effectiveHistory, message, 12);

      // 仅在发往大模型的当前轮内存态 user 消息前挂载实时视口焦点与多模态图像（绝不污染落盘历史）
      if (!isSystemTrigger && workingMessages.length > 0) {
        const lastTurn = workingMessages[workingMessages.length - 1];
        if (lastTurn.role === 'user' && typeof lastTurn.content === 'string') {
          const nextText = focusSection
            ? `<current_viewport_focus>\n${focusSection}\n</current_viewport_focus>\n\n${lastTurn.content}`
            : lastTurn.content;
          lastTurn.content =
            config.llm.supportsVision && focusImages.length > 0
              ? buildMultimodalUserContent(nextText, focusImages)
              : nextText;
        }
      }

      const tools = this.buildDefaultTools(Boolean(isSystemTrigger));
      const effectiveSystemPrompt =
        isSystemTrigger && !tools
          ? `${systemPrompt}\n\n【当前为纯文本阶段复盘模式】：本次无需调用任何工具，也无需发起新提案，请直接以自然语言完整输出专业复盘正文。`
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
              const mayPropose = isSystemTrigger && this.allowPostTaskProposal();
              capturedIntent = isSystemTrigger && (!mayPropose || activeCall.args?.action !== 'propose')
                ? ({ action: 'chat_only', reply: rawToolReply } as TIntent)
                : this.resolveDirectorIntent(activeCall.args);
            }
          }
        } catch (toolCallErr: any) {
          const errMsg = toolCallErr?.message || String(toolCallErr);
          console.warn(
            `[AgentRunner:${this.sessionId}] 解析 toolCalls 异常: ${errMsg}`,
            JSON.stringify({
              action: failedArgs?.action,
              targetTool: failedArgs?.targetTool,
              operationsCount: Array.isArray(failedArgs?.operations) ? failedArgs.operations.length : 0,
              argKeys: failedArgs && typeof failedArgs === 'object' ? Object.keys(failedArgs) : [],
            })
          );
          if (!isSystemTrigger) {
            const existingSpeech = (rawToolReply || streamedReplyText || fullRawText || '').trim();
            let finalErrMsg = errMsg;
            if (!abortSignal?.aborted) {
              try {
                const repaired = await this.repairInvalidIntentCall({
                  agent,
                  workingMessages,
                  existingSpeech,
                  errorMessage: errMsg,
                  abortSignal,
                });
                if (repaired) {
                  capturedIntent = repaired.intent;
                  if (!existingSpeech && repaired.reply) {
                    rawToolReply = repaired.reply;
                  }
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
                reply: existingSpeech
                  ? `${existingSpeech}\n\n（注：未自动生成执行卡片——${finalErrMsg}）`
                  : `提案校验未通过：${finalErrMsg}`,
              } as TIntent;
            }
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
      if ((capturedIntent as any)?.replyOverride) {
        effectiveText = String((capturedIntent as any).reply || '').trim();
      } else if (merged.appendChunk) {
        onTextChunk?.(merged.appendChunk);
      }

      // 反事实文本净化门禁：当行动是 approve 授权开跑时，物理算力即将启动，尚未落盘，绝对严禁宣称已物理落盘！
      if ((capturedIntent as any)?.action === 'approve') {
        if (effectiveText.includes('\n\n---\n\n')) {
          effectiveText = effectiveText.split('\n\n---\n\n')[0].trim();
        }
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
        const originalContent = target ? target.content : '';
        const preSpeech = originalContent.includes('\n\n---\n\n')
          ? originalContent.split('\n\n---\n\n')[0].trim()
          : originalContent;
        const combinedContent = preSpeech
          ? `${preSpeech}\n\n---\n\n${parsed.cleanText}`
          : parsed.cleanText;

        const targetId = target.id;
        const postTaskProposal = isSystemTrigger && (parsed.intent as any)?.action === 'propose';
        const isPlanMessage = Array.isArray(target.planSteps) && target.planSteps.length > 0;
        this.updateMessage(targetId, {
          content: combinedContent,
          ...(postTaskProposal || !isSystemTrigger
            ? { proposal: parsed.intent || undefined, proposalResolved: isAlreadyApproved }
            : {}),
          ...(isPlanMessage
            ? {}
            : {
                taskStatus: 'completed',
                taskProgress: { percent: 100, message: '推演完成' },
              }),
          metadata: { ...target?.metadata, summaryStatus: 'completed' },
        });
        parsed.messageId = targetId;
      } else {
        // 否则作为全新的助手对白原子追加落盘（modify 仅在最终提案通过全部校验后才关闭旧待审提案）
        if ((parsed.intent as any)?.action === 'modify') {
          this.markProposalsResolved();
        }
        const savedEntry = this.appendMessage({
          role: 'assistant',
          content: parsed.cleanText,
          proposal: parsed.intent || undefined,
          proposalResolved: isAlreadyApproved ? true : false,
        });
        parsed.messageId = savedEntry.id;
      }

      await onDone?.(parsed);
      return parsed;
    } catch (err: any) {
      console.error(`[AgentRunner:${this.sessionId}] 流式推演失败:`, err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
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
   * 全系统统一视口焦点与视觉上下文渲染器（SSOT）：偏重当前聚焦对象与用户发图分析，绝不限制全局讨论范围。
   */
  private async renderFocusContextSection(
    focus?: AgentFocusContext,
    ctx?: {
      userMessage?: string;
      attachments?: Array<{ url: string; name?: string }>;
      images?: ResolvedVisionImage[];
      abortSignal?: AbortSignal;
    }
  ): Promise<string> {
    const hasLocation = Boolean(focus?.location?.trim());
    const attachments = ctx?.attachments || [];
    const resolvedImages = ctx?.images || [];
    if (!hasLocation && attachments.length === 0 && resolvedImages.length === 0) return '';

    const lines: string[] = [];

    if (hasLocation && focus) {
      lines.push(`- 当前停留位置：${focus.location.trim()}`);
      if (focus.target) {
        const subviewSuffix = focus.target.subview ? ` · ${focus.target.subview}` : '';
        lines.push(
          `- 当前聚焦对象：${focus.target.label}${subviewSuffix} (kind: ${focus.target.kind}, id: ${focus.target.id})`
        );
      }

      const extraDetails = await this.resolveFocusDetails(focus, { abortSignal: ctx?.abortSignal });
      for (const line of extraDetails || []) {
        const trimmed = String(line || '').trim();
        if (!trimmed) continue;
        lines.push(trimmed.startsWith('- ') ? trimmed : `- ${trimmed}`);
      }
    }

    if (attachments.length > 0) {
      const attDesc = attachments
        .map((att, idx) => `附件${idx + 1}(${att.name || '图片'}, url: ${att.url})`)
        .join('、');
      lines.push(
        `- 创作者本轮发送了 ${attachments.length} 张图片：${attDesc}（若创作者要求以此图作为生图/定妆参考底图，可在对应工具参数 referenceImageUrls 中直接引用上述 url）`
      );
    }

    // 通用多模态眼睛：纯文本主模型时由独立 VLM 结合创作者本轮原话执行多图全面观察并注入当轮记忆
    if (resolvedImages.length > 0 && !config.llm.supportsVision) {
      const visualObservation = await perceiveVisualContext({
        projectId: this.projectId,
        images: resolvedImages,
        userMessage: ctx?.userMessage,
        contextHint: focus?.location,
        abortSignal: ctx?.abortSignal,
      });
      if (visualObservation) {
        const titles = resolvedImages
          .map((img, i) => `图${i + 1}${img.role ? `[${img.role}]` : ''}:${img.label}`)
          .join('、');
        lines.push(`- 当前实时画面视觉观察（已同时查看 ${titles}）：\n${visualObservation}`);
      }
    }

    if (hasLocation && focus) {
      if (focus.target) {
        lines.push(
          '- 焦点使用原则：上述视口焦点代表创作者此刻真实停留的界面与正在查看的对象。若创作者询问“当前在哪个界面/在看什么”，请据实作答；若创作者发出生成、重绘、超分、修改等执行指令且未明确指定“全部/所有/本幕/批量”或其他对象名称（如仅说“帮我把图片生成一下”“超分一下”“改一下”），默认只针对当前聚焦的这 1 个对象（及对应子步骤，如首帧/末帧/视频）发起单步提案，严禁擅自扩展为全量或全幕批量操作；仅当创作者明确说出批量范围或其他对象时，才按指定范围统筹处理。'
        );
      } else {
        lines.push(
          '- 焦点使用原则：上述视口焦点代表创作者此刻真实停留的界面。若创作者询问“当前在哪个界面/在看什么”，请据实依据上述位置作答；讨论或执行范围按创作者指令正常统筹处理。'
        );
      }
    }

    return `【创作者当前实时视口焦点与视觉上下文】：\n${lines.join('\n')}`;
  }



  /**
   * 统一会话提案与物理任务态势摘要（SSOT），让所有专职 Agent 天然感知待审提案与失败任务根因，支撑 P0/P2/P3 决策
   */
  protected renderSessionStateSection(): string {
    if (this.getIntentToolSpecs().length === 0) return '';

    const messages = this.getMessages();
    const lastPending = [...messages].reverse().find((m) => m.proposal && !m.proposalResolved);
    const pendingProposal = lastPending?.proposal as any;
    const pendingLine = pendingProposal
      ? (() => {
          const title = pendingProposal.title || pendingProposal.tool || '待审方案';
          const summaryObj = Array.isArray(pendingProposal.operations) && pendingProposal.operations.length > 0
            ? {
                operations: pendingProposal.operations.map((op: any) => ({
                  targetTool: op.tool,
                  title: op.title,
                  params: op.params,
                })),
              }
            : { targetTool: pendingProposal.tool, params: pendingProposal.params };
          const serialized = JSON.stringify(summaryObj);
          const snippet = serialized.length > 500 ? `${serialized.slice(0, 500)}...` : serialized;
          return `挂起待审【${title}】 | 参数快照: ${snippet}`;
        })()
      : '无';

    const sessionTasks = TaskStore.getInstance()
      .getTasksByProject(this.projectId)
      .filter((task) => (task.input as any)?.__chatContext?.sessionId === this.sessionId);
    const activeTask = sessionTasks.find((t) => t.status === 'running' || t.status === 'pending');
    const failedTask = sessionTasks.find((t) => t.status === 'failed');

    const activeLine = activeTask
      ? `运行中 [${activeTask.toolName}] (进度: ${activeTask.progress?.percent || 0}%)`
      : '无';
    const failedLine = failedTask
      ? (() => {
          const { __chatContext: _c, __idempotencyKey: _k, ...cleanInput } = (failedTask.input || {}) as any;
          const serialized = JSON.stringify(cleanInput);
          const snippet = serialized.length > 300 ? `${serialized.slice(0, 300)}...` : serialized;
          return `失败 [${failedTask.toolName}] (错误: "${failedTask.error || '未知'}" | 入参: ${snippet})`;
        })()
      : '无';

    return `### 【当前会话提案与任务状态】
- 待审提案：${pendingLine}
- 活跃任务：${activeLine}
- 最近失败任务：${failedLine}`;
  }

  /**
   * 业务子类声明支持的合法物理工序工具规范清单 (SSOT)
   * 基类基于此清单自动组装官方 emit_director_intent 意图识别工具
   */
  protected getIntentToolSpecs(): SubmittableToolSpec[] {
    return [];
  }

  public getPostTaskPrompt(task: TaskRecord, title: string): string {
    return `【制片工序事件】工序【${title || task.toolName}】已完成并物理落盘。请核对当前项目资产，向创作者简要汇报实际成果与需要关注的问题。`;
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
请核对当前最新项目资产，用简练清晰的中文向创作者做一次整体汇总复盘（如有失败项请指出原因并提示可在卡片上单步重试）。`;
  }

  protected allowPostTaskProposal(): boolean {
    return false;
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
  }): Promise<{ intent: TIntent; reply?: string } | null> {
    const correctionPrompt = `【系统参数纠偏】你刚才的方案尚未生成可执行卡片，结构校验失败原因：${ctx.errorMessage}。请严格依据本轮上下文与可用能力编目，重新调用 emit_director_intent 补齐合法的 action、targetTool（单步必填，字段名必须为 targetTool；多步改用 operations 数组）及完整必填 params；若确实信息不足无法执行，请调用 action="chat_only"。reply 保持简洁并沿用你刚才的方案说明即可。`;

    let repairMessages: CoreMessage[];
    if (ctx.existingSpeech) {
      repairMessages = [
        ...ctx.workingMessages,
        { role: 'assistant', content: ctx.existingSpeech },
        { role: 'user', content: correctionPrompt },
      ];
    } else if (ctx.workingMessages.length > 0) {
      const cloned = [...ctx.workingMessages];
      const last = cloned[cloned.length - 1];
      if (last.role === 'user' && typeof last.content === 'string') {
        cloned[cloned.length - 1] = { role: 'user', content: `${last.content}\n\n${correctionPrompt}` };
        repairMessages = cloned;
      } else {
        repairMessages = [
          ...cloned,
          { role: 'assistant', content: '我需要补齐可执行方案的结构化参数。' },
          { role: 'user', content: correctionPrompt },
        ];
      }
    } else {
      repairMessages = [{ role: 'user', content: correctionPrompt }];
    }

    const retryResult = streamAgentWithCompat(ctx.agent, repairMessages, {
      maxSteps: 1,
      toolChoice: 'required',
      abortSignal: ctx.abortSignal,
    });
    for await (const _chunk of retryResult.textStream) {
      // 静默消费流，确保 toolCalls 收敛完成且不向前端重复推字
    }
    const retryToolCalls = await retryResult.toolCalls;
    if (!Array.isArray(retryToolCalls) || retryToolCalls.length === 0) return null;
    const retryCall = retryToolCalls[0];
    if (retryCall.toolName !== EMIT_DIRECTOR_INTENT_TOOL_NAME) return null;

    const intent = this.resolveDirectorIntent(retryCall.args) as TIntent;
    const reply = typeof retryCall.args?.reply === 'string' ? retryCall.args.reply.trim() : undefined;
    console.log(`[AgentRunner:${this.sessionId}] 静默自愈纠偏成功，已自动补全合法提案`);
    return { intent, reply };
  }

  /**
   * 基类统一装配的官方人在回路意图识别器 (Intent Resolver Tool)
   * 严格内聚【自顶向下 P0 ➔ P5 多层意图决策漏斗】
   */
  protected buildDefaultTools(isSystemTrigger = false): Record<string, any> | undefined {
    return createIntentTools(
      this.getIntentToolSpecs(),
      isSystemTrigger,
      this.allowPostTaskProposal(),
      this.hasPendingProposal()
    );
  }

  /**
   * 生成标准化的 P0 ➔ P5 意图决策漏斗 Markdown 规约矩阵 (高信噪比 SSOT)
   */
  public static renderFunnelPromptMatrix(): string {
    return `### 【意图决策漏斗 (自顶向下逐层匹配，命中首条即返回，严禁向下穿透)】
| 优先级 | 触发特征 (创作者输入或工程状态) | 决策动作 (action) | 行为规约 (必须同步在对话中阐述，严禁正文留空) |
| :--- | :--- | :--- | :--- |
| **P0·恢复** | 任务失败/报错，创作者询问原因或要求重试 | \`propose\` | 在对话中解释失败根因，复用失败入参重新出具提案 |
| **P1·重推** | 创作者对已有产物不满意、指出偏差或要求推倒重来/重新生成 | \`propose\` | 从当前动态能力编目中选择最匹配的工具，按其 input schema 全量融汇纠偏要求重新出具提案卡片 |
| **P2·修改** | 当前存在待审提案，创作者提出参数明确的局部调整/增删/新约束 | \`modify\` | 信息完整时阐明调整逻辑并输出完整新参数；信息不完整时先用 \`chat_only\` 追问，不得猜测并出卡 |
| **P3·授权** | 当前存在待审提案，创作者表达认可/同意/准了/开跑 | \`approve\` | 在对话中给出干练确认回复，声明 targetTool 授权开跑 |
| **P4·收官** | 当前工序已全部物理落盘，创作者询问下一步 | \`chat_only\` | 总结本阶段成果，告知可进入已解锁的下一工序；不生成提案 |
| **P5·立项** | 暂无待审提案，创作者输入全新题材/故事设定灵感 | \`propose\` | 在对话中深度剖析戏剧冲突与看点，出具方案待审卡片 |
| **P6·探讨** | 纯理论咨询或无实质设定的闲聊 (漏斗兜底) | \`chat_only\` | 进行纯自然语言专业解答，无需发起制片提案 |

### 【全系统对话生命周期刚性纪律 (SSOT)】
- 【严禁自导自演物理落盘与虚假收官（核心红线）】：你不是物理执行引擎！绝对严禁在单条自然语言对话中既声明“收到，授权开跑”，又自说自话在同一条消息中宣称“已物理落盘/工序全线完工/已完成渲染”！绝对严禁在单次回复中拼接“---”分割线伪造任务执行完毕后的收官总结！
  当前存在挂起待审提案，且创作者表达认可同意（如“同意/准了/开跑”）时，物理算力计算尚未开始，你必须且只能调用 emit_director_intent(action: "approve") 授权启动物理执行，并输出干练简短的开跑确认即可；
  真正的物理落盘必须等待物理任务在后台真实跑完后，由系统事件单独驱动你出具阶段复盘！
- 必须输出对话正文（Mandatory Speech）：在调用 emit_director_intent 发射任何意图的同时，必须在自然语言对话流中向创作者清晰说明你的方案亮点、决策理由或确认对白，绝对严禁只调用工具而正文留空；
- 严禁在对话正文中打印任何 XML/JSON 意图标签，所有行动必须通过调用 emit_director_intent 工具发起。`;
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
      let schemaText = '未提供结构化 schema';
      try {
        schemaText = JSON.stringify(zodToJsonSchema(s.schema as any), null, 2);
      } catch {
        // 工具仍可通过 description 工作，schema 序列化失败不应阻断对话。
      }
      return `${index + 1}. 【${s.title}】(targetTool: "${s.toolName}")\n   - 功能与产出: ${s.description}\n   - input schema:\n${schemaText}`;
    });

    return `### 【当前工序阶段可用能力编目 (Dynamic Tools Catalog)】
调用 emit_director_intent 发射决策信号时，请从以下编目中选取最贴合当前业务目标的 targetTool，严禁臆造不存在的工序：
${lines.join('\n')}

### 【全系统通用多步 Plan 编排通则 (Plan → 原子 Tasks SSOT)】
- **单步原子任务**：本次只需调用 1 个工具处理 1 个目标时，直接使用 \`targetTool\` + \`params\`；
- **多步 / 多阶段连跑 Plan**：当创作者要求**批量处理多个目标**，或要求**一次性连续完成多个前后衔接的工序/工具（中途不再停顿审批）**时，请使用 \`operations\` 数组按依赖顺序编排多个原子工具（每步只做 1 件原子事，并填写清晰可读的 \`title\`）；
- **自动数据接力**：Plan 批准一次后，引擎将严格按 \`operations\` 顺序逐项执行，前序步骤落盘到项目黑板的最新产物会被后续步骤自动接力读取（无需在后续步骤重复手填前序尚未生成的正文或链接），全部结束后统一出具 1 次汇总复盘。`;
  }

  /**
   * 将大模型触发的 emit_director_intent 意图识别调用解析为规范的 SessionActionIntent
   * 内置状态机客观门禁校准（Defense in Depth）：防空跑、防参数丢失、防并发重开、防资产缺失假收官、防待审提案越级跳过
   */
  protected resolveDirectorIntent(args: any): any {
    if (!args || typeof args !== 'object') return null;
    const action = args.action;
    if (!['propose', 'modify', 'approve', 'chat_only'].includes(action)) {
      throw new Error('意图动作无效');
    }

    if (action === 'chat_only') {
      return {
        action: 'chat_only',
        title: '',
        params: {},
        reply: args.reply || '',
      };
    }

    const description = typeof args.description === 'string' ? args.description.trim() : '';
    if ((action === 'propose' || action === 'modify') && !description) {
      throw new Error('提案缺少面向创作者的说明 description');
    }
    if (/(?:targetTool|matchedSpec|input schema|params\s*:|film\.[a-z_]+)/i.test(description)) {
      throw new Error('提案说明包含内部工具元数据');
    }

    // 1. 读取当前会话最近一条挂起待审提案 (SSOT)
    const messages = this.getMessages();
    const lastPendingMsg = [...messages].reverse().find((m) => m.proposal && !m.proposalResolved);
    const pendingProposal = lastPendingMsg?.proposal as any;

    if (action === 'approve' && !pendingProposal) {
      return {
        action: 'chat_only',
        title: '',
        params: {},
        reply: '当前没有待确认的方案。请说明要执行的内容，我会先提交方案供你确认。',
      };
    }

    // 2. 目标工序解析：只有 approve 可以继承挂起提案；新提案/修改必须明确选择目标工具。
    const specs = this.getIntentToolSpecs();
    const rawOperations = action === 'approve'
      ? pendingProposal?.operations
      : args.operations;
    const hasOperations = Array.isArray(rawOperations) && rawOperations.length > 0;
    const targetToolName = action === 'approve'
      ? pendingProposal.tool
      : args.targetTool;
    if ((action === 'propose' || action === 'modify') && !targetToolName && !hasOperations) {
      throw new Error('当前提案缺少明确的目标工具，已阻止执行，请先澄清要修改或生成的具体内容');
    }
    const matchedSpec = specs.find((s) => s.toolName === targetToolName);
    if (targetToolName && !matchedSpec) throw new Error(`当前阶段不支持工序: ${targetToolName}`);
    const operations = hasOperations ? rawOperations.map((operation: any) => {
      const operationTool = action === 'approve' ? operation.tool : operation.targetTool;
      const spec = specs.find((item) => item.toolName === operationTool);
      if (!spec) throw new Error(`当前阶段不支持工序: ${operationTool}`);
      const params = { ...(operation.params || {}), projectId: this.projectId };
      const parsed = spec.schema.safeParse(params);
      if (!parsed.success) throw new Error(`${spec.title} 参数不完整: ${parsed.error.issues.map((issue) => issue.path.join('.')).join('、')}`);
      return {
        tool: spec.toolName,
        title: operation.title || spec.title,
        params: parsed.data,
      };
    }) : undefined;
    const toolName = targetToolName || matchedSpec?.toolName;
    const title = args.title || pendingProposal?.title || matchedSpec?.title || '制片工序任务';
    const coverage = action === 'approve'
      ? pendingProposal?.coverage
      : args.coverage ?? (action === 'modify' && !args.targetTool ? pendingProposal?.coverage : undefined);

    // 【门禁 1 · 授权批准执行 (approve)】
    if (action === 'approve') {
      if (operations && operations.length > 0) {
        return {
          action: 'approve',
          ...(toolName ? { tool: toolName } : {}),
          title: pendingProposal?.title || title,
          params: { ...(pendingProposal.params || {}), projectId: this.projectId },
          operations,
          ...(coverage ? { coverage } : {}),
          description: pendingProposal.description,
        };
      }

      // 自动无损继承前序待审提案中的完整参数，并与本次确认参数深度融合
      const finalParams = {
        ...(pendingProposal.params || {}),
        projectId: this.projectId,
      };
      if (!matchedSpec) throw new Error('当前待审方案缺少有效的目标工序');
      const validatedParams = matchedSpec.schema.safeParse(finalParams);
      if (!validatedParams.success) {
        const details = validatedParams.error.issues
          .map((issue) => issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)
          .join('；');
        throw new Error(`${matchedSpec.title} 提案参数已失效，请重新生成方案：${details}`);
      }

      return {
        action: 'approve',
        tool: toolName,
        title: pendingProposal?.title || title,
        params: validatedParams.data,
        ...(coverage ? { coverage } : {}),
        description: pendingProposal.description,
      };
    }

    // 【门禁 2 · 方案修改重塑 (modify)】
    if (action === 'modify') {
      const sameTool = Boolean(toolName && pendingProposal?.tool && toolName === pendingProposal.tool);
      let mergedParams: Record<string, any> = {
        ...(sameTool ? (pendingProposal?.params || {}) : {}),
        ...(args.params || {}),
        projectId: this.projectId,
      };
      if (!operations && matchedSpec) {
        const validated = matchedSpec.schema.safeParse(mergedParams);
        if (!validated.success) {
          const details = validated.error.issues
            .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
            .join('；');
          throw new Error(`${matchedSpec.title} 参数不完整：${details}`);
        }
        mergedParams = { ...(validated.data || {}), projectId: this.projectId };
      }
      const cleanTitle = title.replace(/^【修改方案】\s*/, '');

      return {
        action: 'modify',
        tool: toolName,
        title: `【修改方案】${cleanTitle}`,
        params: mergedParams,
        ...(operations ? { operations } : {}),
        ...(coverage ? { coverage } : {}),
        description,
      };
    }

    // 【门禁 3 · 初次构思出具提案 (propose)】
    let finalProposeParams: Record<string, any> = {
      ...(args.params || {}),
      projectId: this.projectId,
    };
    if (!operations && matchedSpec) {
      const validated = matchedSpec.schema.safeParse(finalProposeParams);
      if (!validated.success) {
        const details = validated.error.issues
          .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
          .join('；');
        throw new Error(`${matchedSpec.title} 参数不完整：${details}`);
      }
      finalProposeParams = { ...(validated.data || {}), projectId: this.projectId };
    }
    return {
      action: 'propose',
      tool: toolName,
      title,
      params: finalProposeParams,
      ...(operations ? { operations } : {}),
      ...(coverage ? { coverage } : {}),
      description,
    };
  }
}
