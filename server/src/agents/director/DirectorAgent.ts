/**
 * agents/director/DirectorAgent.ts
 * AI 导演副手核心智能体 (Director Agent SSOT)
 *
 * 核心机制：
 * 1. 纯天然对话交互界面 (Chat-Centric Interface)；
 * 2. 动态阶段感知 (Stage-Aware SOP Prompting)；
 * 3. 🌟 大模型原生自主决策与提案内生 (0 字符串匹配，彻底消灭误杀)；
 * 4. 🌟 服务端原生流式打字机推进 (OpenAI stream: true，首字毫秒级)；
 * 5. 全局状态黑板单一事实来源 (ProjectStore SSOT)。
 */

import { randomUUID } from 'crypto';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { SessionStore } from '../../chat/session/SessionStore.js';
import { ChatMemoryManager } from '../../chat/memory/ChatMemoryManager.js';
import { buildDirectorSystemPrompt } from './prompt.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { SkillRegistry } from '../../skills/SkillRegistry.js';
import type { ChatMessage, ActionProposal } from '../../chat/session/types.js';
import { CriticReviewerAgent } from '../reviewer/CriticReviewerAgent.js';
import type { ReviewReport } from '../reviewer/types.js';

export interface ChatStreamCallbacks {
  onToken?: (token: string) => Promise<void> | void;
  onThought?: (thought: string) => Promise<void> | void;
  onProposal?: (proposal: ActionProposal) => Promise<void> | void;
}

export class DirectorAgent {
  private static instance?: DirectorAgent;

  public static getInstance(): DirectorAgent {
    if (!DirectorAgent.instance) {
      DirectorAgent.instance = new DirectorAgent();
    }
    return DirectorAgent.instance;
  }

  /**
   * 🌟 核心流式对话入口 (大模型端到端自主决策与真流式打字机)
   */
  public async chatStream(
    projectId: string,
    sessionId: string,
    userContent: string,
    callbacks?: ChatStreamCallbacks,
    abortSignal?: AbortSignal
  ): Promise<{ replyMessage: ChatMessage; proposal?: ActionProposal }> {
    const sessionStore = SessionStore.getInstance();
    const memoryManager = ChatMemoryManager.getInstance();
    const projectStore = ProjectStore.getInstance();

    const project = projectStore.getProject(projectId);
    const session = sessionStore.getSession(projectId, sessionId);

    if (!session) {
      throw new Error(`[DirectorAgent] 会话 ${sessionId} 不存在`);
    }

    // 🌟 单一事实来源 (SSOT)：项目当前工序阶段以 ProjectStore 状态黑板为准
    const currentStage = project?.currentStage || session.currentStage || 'narrative_design';
    const trimmedInput = userContent.trim();

    // 1. 记录并持久化用户新消息 (SSOT)
    const userMessage: ChatMessage = {
      id: `msg_user_${randomUUID().slice(0, 8)}`,
      role: 'user',
      content: trimmedInput,
      createdAt: new Date().toISOString(),
    };
    sessionStore.appendMessage(projectId, sessionId, userMessage);

    // 2. 动态组装双轨记忆上下文 (系统SOP + 外挂技能清单 + 审查官门禁拦截告诫 + 全局白板 + 滑动窗口)
    const rawSystemPrompt = buildDirectorSystemPrompt(currentStage);
    const skillsPrompt = SkillRegistry.getInstance().formatSkillsForPrompt();

    // 🌟 双核博弈自愈闭环 (Director ⇄ Critic Feedback Loop)：感知独立审查官门禁拦截报告 (自动识别时效性与阶段隔离)
    const reviewReport = CriticReviewerAgent.getInstance().getEffectiveReport(projectId);
    let reviewDirective = '';
    if (
      reviewReport &&
      reviewReport.stageReviewed === currentStage && // 🌟 刚性阶段隔离：仅当审查报告属于当前工序时生效，彻底消除跨阶段幽灵拦截
      reviewReport.gateStatus !== 'PASS' &&
      reviewReport.gateStatus !== 'STALE' &&
      reviewReport.criticalFlaws &&
      reviewReport.criticalFlaws.length > 0
    ) {
      const flawsSummary = reviewReport.criticalFlaws
        .map((f, i) => `${i + 1}. [${f.severity}] ${f.location}: ${f.description}\n   -> 审查官修改建议: ${f.suggestion}`)
        .join('\n');

      reviewDirective = `\n\n🚨【独立影视审查官与剧本医生门禁拦截告诫 (Critic Gate Alert)】\n` +
        `审查官已针对当前工序出具了【${reviewReport.gateStatus}】决策 (总评: ${reviewReport.scores.overallScore}/100)！\n` +
        `终审评语: "${reviewReport.verdict}"\n` +
        `以下核心逻辑破绽已被门禁刚性拦截:\n${flawsSummary}\n\n` +
        `【总导演本次对话应对铁律】：\n` +
        `1. 你必须在本次自然回复中，主动且严肃地向创作者指出上述破绽，并重点引导创作者推敲具体的戏剧自愈与设定修正方案；\n` +
        `2. 在上述致命破绽未被解决前，严禁发起推进下一阶段工序的行动提案！\n`;
    }

    const combinedSystemPrompt = `${rawSystemPrompt}${skillsPrompt}${reviewDirective}`;

    const existingMessages = sessionStore.getMessages(projectId, sessionId);
    const assembled = memoryManager.assembleContext(
      session,
      combinedSystemPrompt,
      existingMessages
    );

    // 3. 规范化多轮对话 turns (滑动窗口直接映射，彻底杜绝重复压入)
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of assembled.slidingWindowMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        turns.push({ role: msg.role, content: msg.content });
      }
    }

    // 4. 调用大模型原生真流式生成 (带双向闭环前缀滑动探视状态机，进出双向无损)
    const llm = LLMRegistry.get();
    const OPEN_TAG = '<action_proposal>';
    const CLOSE_TAG = '</action_proposal>';
    let rawOutput = '';
    let isInsideProposal = false;
    let pendingBuffer = '';
    let proposalBuffer = '';

    await llm.generateMultiTurnStream(
      assembled.systemPromptWithScratchpad,
      turns,
      async (token) => {
        rawOutput += token;

        if (isInsideProposal) {
          // 在提案协议块内部：缓冲并探视 CLOSE_TAG 闭合
          proposalBuffer += token;
          const closeIndex = proposalBuffer.indexOf(CLOSE_TAG);
          if (closeIndex !== -1) {
            // 协议块闭合！提取闭合标签之后的多余文本重新送入 pendingBuffer 继续发射
            const afterClose = proposalBuffer.slice(closeIndex + CLOSE_TAG.length);
            isInsideProposal = false;
            proposalBuffer = '';
            if (afterClose) {
              pendingBuffer += afterClose;
            }
          } else {
            // 仍在协议块内部，截留不上屏
            return;
          }
        } else {
          pendingBuffer += token;
        }

        // 前缀滑动探视状态机 (Prefix Lookahead State Machine)
        while (pendingBuffer.length > 0 && !isInsideProposal) {
          const tagIndex = pendingBuffer.indexOf(OPEN_TAG);
          if (tagIndex !== -1) {
            // 匹配到了完整的标签前缀，先吐出标签前的安全正文
            const safeText = pendingBuffer.slice(0, tagIndex);
            if (safeText && callbacks?.onToken) {
              await callbacks.onToken(safeText);
            }
            // 切换为进入状态，将 OPEN_TAG 之后的内容注入 proposalBuffer 待关闭
            proposalBuffer = pendingBuffer.slice(tagIndex + OPEN_TAG.length);
            pendingBuffer = '';
            isInsideProposal = true;

            // 检查当前 chunk 是否已经包含了 CLOSE_TAG
            const closeIndex = proposalBuffer.indexOf(CLOSE_TAG);
            if (closeIndex !== -1) {
              const afterClose = proposalBuffer.slice(closeIndex + CLOSE_TAG.length);
              isInsideProposal = false;
              proposalBuffer = '';
              if (afterClose) {
                pendingBuffer = afterClose;
              }
            }
            break;
          }

          // 探视 pendingBuffer 末尾是否存在 OPEN_TAG 的前缀候选
          let candidateIndex = -1;
          for (let i = 0; i < pendingBuffer.length; i++) {
            const sub = pendingBuffer.slice(i);
            if (OPEN_TAG.startsWith(sub)) {
              candidateIndex = i;
              break;
            }
          }

          if (candidateIndex === -1) {
            // 当前缓冲区无任何疑似协议前缀，为纯安全正文，立即吐出
            if (callbacks?.onToken) {
              await callbacks.onToken(pendingBuffer);
            }
            pendingBuffer = '';
          } else if (candidateIndex > 0) {
            // 候选前缀之前的正文是安全的，立即吐出
            const safeText = pendingBuffer.slice(0, candidateIndex);
            if (callbacks?.onToken) {
              await callbacks.onToken(safeText);
            }
            pendingBuffer = pendingBuffer.slice(candidateIndex);
            break; // 挂起疑似前缀，等待后续 token 探视
          } else {
            // candidateIndex === 0，整个缓冲区都是潜在标签前缀，挂起探视
            break;
          }
        }
      },
      {
        stage: `director_chat_${currentStage}`,
        abortSignal,
        temperature: 0.7,
      }
    );

    // 🌟 流式结束健全性收敛 (截断防护)：若因 Token 限制或网络中断导致未闭合 </action_proposal>
    if (isInsideProposal) {
      if (proposalBuffer.length > 0) {
        rawOutput += '</action_proposal>';
      }
      isInsideProposal = false;
      proposalBuffer = '';
    }

    // 流式结束收尾：若 pendingBuffer 仍有未决正文（非协议标签），全量 Flush 吐出，保证零丢字
    if (pendingBuffer.length > 0) {
      if (callbacks?.onToken) {
        await callbacks.onToken(pendingBuffer);
      }
      pendingBuffer = '';
    }

    // 5. 提取大模型自主决定的行动提案 (Native Action Proposal Extraction)
    let proposal: ActionProposal | undefined;
    let cleanReplyText = rawOutput;

    const proposalMatch = rawOutput.match(/<action_proposal>([\s\S]*?)<\/action_proposal>/);
    if (proposalMatch && proposalMatch[1]) {
      try {
        const rawJson = proposalMatch[1].trim();
        const parsed = JSON.parse(rawJson);
        const resolvedSkill = parsed.skill || parsed.payload?.skill || 'story-bible';

        proposal = {
          actionId: `act_${randomUUID().slice(0, 8)}`,
          actionType: parsed.actionType || 'TRIGGER_STAGE',
          skill: resolvedSkill, // 🌟 顶层标准技能标识提升 (SSOT)
          label: parsed.label || '推进当前工序',
          description: parsed.description || '',
          status: 'pending', // 🌟 初始生命周期状态：待确认待执行
          payload: {
            stage: currentStage,
            skill: resolvedSkill,
            ...(parsed.payload || {}),
          },
        };

        // 🌟 第三道视听工程刚性门禁：代码级刚性拦截守卫 (Fail-Fast Gate Guard)
        // 若审查官针对当前工序出具了刚性阻断 FAIL 且该报告仍在生效期
        if (
          proposal &&
          reviewReport &&
          reviewReport.stageReviewed === currentStage &&
          reviewReport.gateStatus === 'FAIL'
        ) {
          const isAllowedRecovery = resolvedSkill === 'critic-review' || resolvedSkill.includes('refine');
          if (!isAllowedRecovery) {
            console.warn(`[DirectorAgent] 触发代码级刚性门禁拦截：当前工序 [${currentStage}] 存在 CRITICAL 破绽，阻断推进提案 [${resolvedSkill}] 下发`);
            proposal = undefined; // 刚性阻断，绝不下发带病推进提案！
          }
        }

        if (proposal && callbacks?.onProposal) {
          await callbacks.onProposal(proposal);
        }
      } catch (err) {
        console.warn('[DirectorAgent] 解析大模型自主行动提案 JSON 警告:', err);
      }

      // 从最终保存的自然语言回复中剔除 <action_proposal> 协议块
      cleanReplyText = rawOutput.replace(/<action_proposal>[\s\S]*?<\/action_proposal>/g, '').trim();
    }

    // 6. 组装并持久化 Assistant 回复消息
    const replyMessage: ChatMessage = {
      id: `msg_asst_${randomUUID().slice(0, 8)}`,
      role: 'assistant',
      content: cleanReplyText,
      actionProposal: proposal,
      createdAt: new Date().toISOString(),
    };
    sessionStore.appendMessage(projectId, sessionId, replyMessage);

    // 7. 旁路异步检查更新全局白板
    memoryManager.maybeTriggerBackgroundSummarization(projectId, sessionId);

    return {
      replyMessage,
      proposal,
    };
  }
}
