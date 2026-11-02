/**
 * agents/director/DirectorAgent.ts
 * AI 导演副手对话智能体门面实体 (基于 Vercel AI SDK 原生 Tool Calling 架构)
 *
 * 核心机制：
 * 1. 自然语言双向流式对话交互；
 * 2. 原生 Tool Calling (propose_stage_action)：彻底废弃字符串标签解析，实现 100% 结构化提案；
 * 3. 纯净文本与独立思考流分片 (text-delta & reasoning) 天然隔离；
 * 4. 统一委托 GateGuard 实施刚性门禁防护；
 * 5. 异常中断截断保全与成对角色交替保障。
 */

import { randomUUID } from 'crypto';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { ProjectStore, ProposalStore } from '../../project-store/index.js';
import { ChatMemoryManager } from '../../chat/memory/ChatMemoryManager.js';
import { DirectorContextAssembler } from './DirectorContextAssembler.js';
import { DirectorProposalResolver } from './DirectorProposalResolver.js';
import { proposeStageActionTool, type ProposeStageActionInput } from './schema.js';
import type { ChatMessage, ActionProposal } from '../../chat/session/types.js';
import type { ChatStreamCallbacks, DirectorStreamResult } from './types.js';

export class DirectorAgent {
  private static instance?: DirectorAgent;

  public static getInstance(): DirectorAgent {
    if (!DirectorAgent.instance) {
      DirectorAgent.instance = new DirectorAgent();
    }
    return DirectorAgent.instance;
  }

  /**
   * 🌟 核心流式对话推演 (Vercel AI SDK 原生 Tool Call + 纯净文本流式推送)
   */
  public async chatStream(
    projectId: string,
    sessionId: string,
    userContent: string,
    callbacks?: ChatStreamCallbacks,
    abortSignal?: AbortSignal
  ): Promise<DirectorStreamResult> {
    const projectStore = ProjectStore.getInstance();
    const memoryManager = ChatMemoryManager.getInstance();
    const contextAssembler = DirectorContextAssembler.getInstance();
    const proposalResolver = DirectorProposalResolver.getInstance();

    // 1. 录入创作者 User 消息并立即持久化 (SSOT)
    const userMessage: ChatMessage = {
      id: `msg_user_${randomUUID().slice(0, 8)}`,
      role: 'user',
      content: userContent,
      createdAt: new Date().toISOString(),
    };
    projectStore.appendMessage(projectId, sessionId, userMessage);

    // 2. 组装面向大模型的全景上下文 (SOP + 技能清单 + 权威视听交付物 + 审查官告诫 + 规范化多轮 Turns)
    const context = contextAssembler.assemble(projectId, sessionId);

    const llm = LLMRegistry.get();
    let replyContent = '';
    let reasoningContent = '';
    let capturedProposalArgs: ProposeStageActionInput | null = null;

    try {
      await llm.generateMultiTurnStream(
        context.systemPromptWithScratchpad,
        context.turns,
        async (token) => {
          replyContent += token;
          if (callbacks?.onToken) await callbacks.onToken(token);
        },
        {
          stage: context.currentStage,
          abortSignal,
          temperature: 0.7,
          // 🌟 人在回路核心停火铁律 (Human-in-the-Loop SSOT):
          // 1. 本调用严格遵循单步终止约定 (maxSteps: 1 语义)，大模型在流式对话中【仅产生行动建议 (Proposal)，绝对禁止在后台自动执行任何工具】；
          // 2. 严禁为 tool 挂载 execute 执行体导致后台私自自动执行；
          // 3. 所有工具调用均由 onToolCall 拦截转化为 pending 待确认行动卡片，必须 100% 经由创作者手动点击才可在 TaskEngine 中立项执行。
          tools: {
            propose_stage_action: proposeStageActionTool,
          },
          onThought: async (thought) => {
            reasoningContent += thought;
            if (callbacks?.onThought) await callbacks.onThought(thought);
          },
          onToolCall: async (tc) => {
            if (tc.toolName === 'propose_stage_action') {
              capturedProposalArgs = tc.args as ProposeStageActionInput;
            }
          },
        }
      );
    } catch (err: any) {
      const isAborted = abortSignal?.aborted || err?.name === 'AbortError';
      const interruptNotice = isAborted
        ? '【创作者已主动中断本次生成】'
        : `【导演副手生成中断: ${err.message || '网络连接中断，请重试'}】`;

      const finalContent = replyContent.trim() ? `${replyContent.trim()}\n\n${interruptNotice}` : interruptNotice;

      const fallbackReply: ChatMessage = {
        id: `msg_asst_${randomUUID().slice(0, 8)}`,
        role: 'assistant',
        content: finalContent,
        thought: reasoningContent.trim() || undefined,
        isError: !isAborted,
        isAborted,
        createdAt: new Date().toISOString(),
      };
      projectStore.appendMessage(projectId, sessionId, fallbackReply);
      throw err;
    }

    // 4. 解析行动提案并执行统一代码级视听刚性门禁防御
    let proposal: ActionProposal | undefined = undefined;
    if (capturedProposalArgs) {
      proposal = await proposalResolver.resolveFromToolCall(
        capturedProposalArgs,
        context.currentStage,
        context.reviewReport,
        callbacks
      );
    }

    if (proposal) {
      ProposalStore.getInstance().saveProposal(projectId, proposal);

      // 单一活跃提案互斥流转：将旧的 pending 提案置换为 superseded，杜绝卡片堆叠
      try {
        const existingMessages = projectStore.getMessages(projectId, sessionId);
        let messagesUpdated = false;
        for (const msg of existingMessages) {
          if (msg.actionProposal && msg.actionProposal.status === 'pending' && msg.actionProposal.actionId !== proposal.actionId) {
            msg.actionProposal.status = 'dismissed';
            msg.actionProposal.description = `[已由最新探讨决策替代] 《${proposal.label}》`;
            messagesUpdated = true;
            ProposalStore.getInstance().updateProposalStatus(projectId, msg.actionProposal.actionId, 'dismissed', {
              description: `[已由最新探讨决策替代] 《${proposal.label}》`,
            });
          }
        }
        if (messagesUpdated) {
          projectStore.saveMessages(projectId, sessionId, existingMessages);
        }
      } catch (cleanErr) {
        console.warn('[DirectorAgent] 旧提案置换清理警告:', cleanErr);
      }
    }

    // 5. 组装并持久化 Assistant 回复消息 (纯 Tool Call 时自动注入承接语，杜绝空白气泡)
    let finalContent = replyContent.trim();
    if (!finalContent) {
      if (proposal) {
        finalContent = '🎬 当前戏剧决策推敲已成熟，我已为您生成工序落地执行方案，请查阅下方卡片确认推进。';
      } else {
        finalContent = '🎬 收到，我们继续推敲本阶段的视听与戏剧设计。';
      }
    }

    const replyMessage: ChatMessage = {
      id: `msg_asst_${randomUUID().slice(0, 8)}`,
      role: 'assistant',
      content: finalContent,
      thought: reasoningContent.trim() || undefined,
      actionProposal: proposal,
      createdAt: new Date().toISOString(),
    };
    projectStore.appendMessage(projectId, sessionId, replyMessage);

    // 6. 旁路异步检查更新全局白板
    memoryManager.maybeTriggerBackgroundSummarization(projectId, sessionId);

    return {
      replyMessage,
      proposal,
    };
  }
}
