/**
 * server/src/chat/BaseChatSession.ts
 * 通用对话会话微内核基类 (Base Chat Session SSOT)
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

import fs from 'node:fs';
import path from 'node:path';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { getProjectDir } from '../project-store/artifact-fs.js';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { safeReadJsonSync, atomicWriteJsonSync } from '../utils/atomicFile.js';
import { LLMProvider } from '../llm/index.js';
import { TaskStore } from '../task-engine/task-store.js';
import { buildWorkingDialogueTurns } from '../mastra-compat/streamAgent.js';
import type {
  SessionChatMessage,
  ParsedIntentResult,
  StreamChatOptions,
  SubmittableToolSpec,
  SessionActionIntent,
} from './types.js';

export const EMIT_DIRECTOR_INTENT_TOOL_NAME = 'emit_director_intent';

export interface BaseChatSessionOptions {
  projectId: string;
  sessionId: string;
}

export abstract class BaseChatSession<TIntent = any> {
  public readonly projectId: string;
  public readonly sessionId: string;
  protected readonly sessionFilePath: string;

  constructor(options: BaseChatSessionOptions) {
    if (!options.projectId) {
      throw new Error('[BaseChatSession] 缺少有效 projectId');
    }
    if (!options.sessionId) {
      throw new Error('[BaseChatSession] 缺少有效 sessionId');
    }

    this.projectId = options.projectId;
    this.sessionId = options.sessionId;

    const projectDir = getProjectDir(this.projectId);
    const chatDir = path.join(projectDir, 'chat');
    if (!fs.existsSync(chatDir)) {
      fs.mkdirSync(chatDir, { recursive: true });
    }

    this.sessionFilePath = path.join(chatDir, `${this.sessionId}.json`);
    this.ensureSessionInitialized();
  }

  /**
   * 初始化会话文件
   */
  private ensureSessionInitialized(): void {
    if (!fs.existsSync(this.sessionFilePath)) {
      atomicWriteJsonSync(this.sessionFilePath, []);
    }
  }

  /**
   * 获取本会话全部对白记录
   */
  public getMessages(): SessionChatMessage<TIntent>[] {
    const data = safeReadJsonSync<SessionChatMessage<TIntent>[]>(this.sessionFilePath);
    return Array.isArray(data) ? data : [];
  }

  /**
   * 向本会话原子追加一条消息并刚性落盘（支持同时仲裁待审提案）
   */
  public appendMessage(
    record: Partial<SessionChatMessage<TIntent>> & { role: 'user' | 'assistant' | 'system'; content: string },
    resolveProposals?: boolean
  ): SessionChatMessage<TIntent> {
    const messages = this.getMessages();

    // 若指定解决未决提案，遍历将历史未决 proposal 标记为 resolved
    if (resolveProposals) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const item = messages[i];
        if (item.proposal && !item.proposalResolved) {
          item.proposalResolved = true;
          break; // 解决最近一条待审提案
        }
      }
    }

    const newEntry: SessionChatMessage<TIntent> = {
      id: record.id || `msg_${record.role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: record.role,
      content: String(record.content || ''),
      createdAt: record.createdAt || new Date().toISOString(),
      ...(record.proposal !== undefined ? { proposal: record.proposal } : {}),
      ...(record.proposalResolved !== undefined ? { proposalResolved: Boolean(record.proposalResolved) } : {}),
      ...(record.status ? { status: record.status } : {}),
      ...(record.taskId ? { taskId: record.taskId } : {}),
      ...(record.taskTool ? { taskTool: record.taskTool } : {}),
      ...(record.taskTitle ? { taskTitle: record.taskTitle } : {}),
      ...(record.taskStatus ? { taskStatus: record.taskStatus } : {}),
      ...(record.taskProgress ? { taskProgress: record.taskProgress } : {}),
      ...(record.taskDurationMs !== undefined ? { taskDurationMs: record.taskDurationMs } : {}),
      ...(record.taskOutputSummary ? { taskOutputSummary: record.taskOutputSummary } : {}),
      ...(record.taskError ? { taskError: record.taskError } : {}),
      ...(record.metadata ? { metadata: record.metadata } : {}),
    };

    messages.push(newEntry);
    atomicWriteJsonSync(this.sessionFilePath, messages);

    return newEntry;
  }

  /**
   * 标记本会话内所有待审提案为已解决
   */
  public markProposalsResolved(): void {
    const messages = this.getMessages();
    let modified = false;

    for (const msg of messages) {
      if (msg.proposal && !msg.proposalResolved) {
        msg.proposalResolved = true;
        modified = true;
      }
    }

    if (modified) {
      atomicWriteJsonSync(this.sessionFilePath, messages);
    }
  }

  /**
   * 原地更新某条消息（支持按 messageId 或 taskId 双向定位）
   */
  public updateMessage(messageId: string, patch: Partial<SessionChatMessage<TIntent>>): void {
    const messages = this.getMessages();
    let target = messages.find((m) => m.id === messageId);
    if (!target && messageId.startsWith('msg_task_')) {
      const tid = messageId.replace(/^msg_task_/, '');
      target = messages.find((m) => m.taskId === tid);
    }
    if (!target && (patch as any)?.taskId) {
      target = messages.find((m) => m.taskId === (patch as any).taskId);
    }
    if (!target) return;

    Object.assign(target, patch);
    atomicWriteJsonSync(this.sessionFilePath, messages);
  }

  /**
   * 清空本会话历史
   */
  public clearMessages(): void {
    atomicWriteJsonSync(this.sessionFilePath, []);
  }

  /**
   * 模板方法：流式推演驱动流
   * 1. 首跳先行落盘用户发言（源头治理，绝不在流式中断时丢消息）；
   * 2. 调用子类 assembleSystemPrompt() 组装专业人设与工序看板；
   * 3. 驱动 streamText 输出；
   * 4. 捕获模型触发的真 Tool Call 并结构化转化为 Pending 提案卡片。
   */
  public async stream(options: StreamChatOptions<TIntent>): Promise<ParsedIntentResult<TIntent>> {
    const { message, history, isSystemTrigger, abortSignal, onTextChunk, onDone, onError } = options;

    // 1. 用户发言首跳立即刚性落盘（除非是内部事件触发）
    if (!isSystemTrigger) {
      this.appendMessage({
        role: 'user',
        content: message,
      });
    }

    try {
      // 2. 调用子类实现的抽象钩子装配业务层 System Prompt，并自动动态注入工序能力编目
      const baseSystemPrompt = await this.assembleSystemPrompt();
      const toolsCatalog = this.renderDynamicToolsCatalog();
      const systemPrompt = toolsCatalog
        ? `${baseSystemPrompt}\n\n${toolsCatalog}`
        : baseSystemPrompt;
      const model = LLMProvider.getModel();

      // 3. 构建多轮对白上下文，并为带 taskId 的卡片消息注入真实执行状态与错误标记
      const taskStore = TaskStore.getInstance();
      const serverMessages = this.getMessages();

      const effectiveHistory = serverMessages.map((m) => {
        let content = m.content;
        if (m.taskId) {
          const liveTask = taskStore.getTask(m.taskId);
          const currentStatus = liveTask?.status || m.taskStatus || 'completed';
          const errorMsg = liveTask?.error || m.taskError;
          const duration = liveTask?.durationMs || m.taskDurationMs;

          let statusTag = '';
          if (currentStatus === 'failed') {
            statusTag = `❌ 执行失败 (错误原因: ${errorMsg || '未知异常'})`;
          } else if (currentStatus === 'completed') {
            statusTag = `✓ 执行完成${duration ? ` (耗时: ${(duration / 1000).toFixed(1)}s)` : ''}`;
          } else if (currentStatus === 'running' || currentStatus === 'pending') {
            statusTag = `⏳ 正在执行中 (进度: ${liveTask?.progress?.percent || m.taskProgress?.percent || 0}%)`;
          } else {
            statusTag = currentStatus;
          }

          content = `[制片任务记录 | taskId: ${m.taskId} | 工序: ${m.taskTitle || m.taskTool || '制片任务'} | 状态: ${statusTag}]\n${content}`;
        }

        return {
          role: m.role,
          content,
        };
      });

      const workingMessages = buildWorkingDialogueTurns(effectiveHistory, message, 12);

      const tools = this.buildDefaultTools();

      const result = await streamText({
        model,
        system: systemPrompt,
        messages: workingMessages,
        tools,
        abortSignal,
      });

      let fullRawText = '';

      for await (const chunk of result.textStream) {
        fullRawText += chunk;
        onTextChunk?.(chunk);
      }

      // 4. 原生 Tool Call 拦截与转译（人在回路切面）：
      // 若大模型在推演中触发了官方意图工具，系统拦截该调用并结构化转化为 Pending 状态的 ActionProposal 实体卡片
      let capturedIntent: TIntent | null = null;

      if (tools) {
        try {
          const toolCalls = await result.toolCalls;
          if (Array.isArray(toolCalls) && toolCalls.length > 0) {
            const activeCall = toolCalls[0];
            if (activeCall.toolName === EMIT_DIRECTOR_INTENT_TOOL_NAME) {
              capturedIntent = this.resolveDirectorIntent(activeCall.args);
            }
          }
        } catch (toolCallErr) {
          console.warn(`[BaseChatSession:${this.sessionId}] 解析 toolCalls 异常:`, toolCallErr);
        }
      }

      // 5. 组装纯净的流式推演结果与人在回路提案
      let effectiveText = fullRawText.trim();
      if (!effectiveText && capturedIntent) {
        const intentObj = capturedIntent as any;
        const actTitle = intentObj.title || '制片工序';
        if (intentObj.action === 'approve') {
          effectiveText = `**授权确认，开跑。**\n\n方案已锁定，我现在授权启动【${actTitle}】工序，正在调度物理引擎落盘。`;
        } else {
          effectiveText =
            intentObj.reasoning ||
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
        onDone?.(emptyResult);
        return emptyResult;
      }

      const parsed: ParsedIntentResult<TIntent> = {
        cleanText: effectiveText,
        intent: capturedIntent,
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
        const originalContent = target ? target.content : '';
        const combinedContent = originalContent
          ? `${originalContent}\n\n---\n\n${parsed.cleanText}`
          : parsed.cleanText;

        const targetId = target ? target.id : options.targetMessageId;
        this.updateMessage(targetId, {
          content: combinedContent,
          proposal: parsed.intent || undefined,
          proposalResolved: isAlreadyApproved ? true : false,
          taskStatus: 'completed',
          taskProgress: { percent: 100, message: '推演完成' },
        });
        parsed.messageId = targetId;
      } else {
        // 否则作为全新的助手对白原子追加落盘
        const savedEntry = this.appendMessage({
          role: 'assistant',
          content: parsed.cleanText,
          proposal: parsed.intent || undefined,
          proposalResolved: isAlreadyApproved ? true : false,
        });
        parsed.messageId = savedEntry.id;
      }

      onDone?.(parsed);
      return parsed;
    } catch (err: any) {
      console.error(`[BaseChatSession:${this.sessionId}] 流式推演失败:`, err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  /**
   * 业务子类必须实现的 System Prompt 装配逻辑（注入专属 SOP 状态机、人设、制片规则）
   */
  protected abstract assembleSystemPrompt(): string | Promise<string>;

  /**
   * 业务子类声明支持的合法物理工序工具规范清单 (SSOT)
   * 基类基于此清单自动组装官方 emit_director_intent 意图识别工具
   */
  protected getIntentToolSpecs(): SubmittableToolSpec[] {
    return [];
  }

  /**
   * 基类统一装配的官方人在回路意图识别器 (Intent Resolver Tool)
   * 严格内聚【自顶向下 P0 ➔ P5 多层意图决策漏斗】
   */
  protected buildDefaultTools(): Record<string, any> | undefined {
    const specs = this.getIntentToolSpecs();
    if (!specs || specs.length === 0) {
      return undefined;
    }

    const availableToolsDescription = specs
      .map((s) => `- ${s.toolName}: ${s.description} (卡片标题: ${s.title})`)
      .join('\n');

    const targetToolEnum = specs.map((s) => s.toolName);

    return {
      [EMIT_DIRECTOR_INTENT_TOOL_NAME]: tool({
        description: `制片意图决策工具。依据 System Prompt 中的【P0➔P5 意图决策漏斗】判定后调用。注意：调用本工具的同时，必须在自然语言对话流中向创作者同步输出阐述对白，严禁正文留空。
- propose: 针对新构思或失败重试，出具包含制片参数的待审方案卡片；
- approve: 创作者明确同意/认可当前挂起提案时调用，直接授权启动物理执行；
- modify: 创作者针对当前方案提出修改意见时调用，输出合并调整后的新制片参数；
- next_stage: 当前工序全部完工，提议流转至下一工序阶段；
- chat_only: 纯探讨咨询或仅进度汇报，无需产生制片提案卡片。
当前阶段可选工序:
${availableToolsDescription}`,
        parameters: z.object({
          action: z
            .enum(['propose', 'approve', 'modify', 'next_stage', 'chat_only'])
            .describe('意图动作类型：propose(出具提案), approve(识别同意并授权开跑), modify(修改参数), next_stage(推进工序), chat_only(纯探讨)'),
          targetTool: z
            .string()
            .optional()
            .describe(`目标工序标识符（当 action=propose/approve/modify 时必填，可选: ${targetToolEnum.join(', ')}）`),
          title: z.string().optional().describe('卡片方案标题，例如“推演互动全景剧本”'),
          reasoning: z.string().optional().describe('方案构思阐述、修改亮点或同意执行确认理由'),
          params: z.record(z.any()).optional().describe('制片参数，须严格符合对应工具的参数定义（例如 userPrompt, expectedActs）'),
          stage: z.string().optional().describe('目标工序阶段（当 action=next_stage 时必填，例如 visual）'),
          summary: z.string().optional().describe('阶段交接总结'),
        }),
      }),
    };
  }

  /**
   * 生成标准化的 P0 ➔ P5 意图决策漏斗 Markdown 规约矩阵 (高信噪比 SSOT)
   */
  public static renderFunnelPromptMatrix(): string {
    return `### 【意图决策漏斗 (自顶向下逐层匹配，命中首条即返回，严禁向下穿透)】
| 优先级 | 触发特征 (创作者输入或工程状态) | 决策动作 (action) | 行为规约 (必须同步在对话中阐述，严禁正文留空) |
| :--- | :--- | :--- | :--- |
| **P0·恢复** | 任务失败/报错，创作者询问原因或要求重试 | \`propose\` | 在对话中解释失败根因，复用失败入参重新出具提案 |
| **P1·修改** | 当前存在待审提案，创作者提出调整/增删/新约束 | \`modify\` | 在对话中阐明调整逻辑，合并修改意见输出完整新参数 |
| **P2·授权** | 当前存在待审提案，创作者表达认可/同意/准了/开跑 | \`approve\` | 在对话中给出干练确认回复，声明 targetTool 授权开跑 |
| **P3·推进** | 当前工序已全部物理落盘，创作者要求进入下一步 | \`next_stage\` | 在对话中总结本阶段成果，声明 stage 提议跨工序移交 |
| **P4·立项** | 暂无待审提案，创作者输入全新题材/故事设定灵感 | \`propose\` | 在对话中深度剖析戏剧冲突与看点，出具方案待审卡片 |
| **P5·探讨** | 纯理论咨询或无实质设定的闲聊 (漏斗兜底) | \`chat_only\` | 进行纯自然语言专业解答，无需发起制片提案 |`;
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
      return `${index + 1}. 【${s.title}】(targetTool: "${s.toolName}")\n   - 功能与产出: ${s.description}`;
    });

    return `### 【当前工序阶段可用能力编目 (Dynamic Tools Catalog)】
调用 emit_director_intent 发射决策信号时，请从以下编目中选取最贴合当前业务目标的 targetTool，严禁臆造不存在的工序：
${lines.join('\n')}`;
  }

  /**
   * 将大模型触发的 emit_director_intent 意图识别调用解析为规范的 SessionActionIntent
   * 内置状态机客观门禁校准（Defense in Depth）：防空跑、防参数丢失、防并发重开
   */
  protected resolveDirectorIntent(args: any): any {
    if (!args || typeof args !== 'object') return null;
    const action = args.action || 'propose';

    if (action === 'chat_only') {
      return null;
    }

    if (action === 'next_stage') {
      return {
        action: 'next_stage',
        stage: args.stage || 'visual',
        title: args.title || '推进至下一阶段',
        params: { projectId: this.projectId },
        description: args.summary || args.reasoning || '当前工序已达成，推进至下一工序',
      };
    }

    // 1. 读取当前会话最近一条挂起待审提案
    const messages = this.getMessages();
    const lastPendingMsg = [...messages].reverse().find((m) => m.proposal && !m.proposalResolved);
    const pendingProposal = lastPendingMsg?.proposal as any;

    // 2. 目标工序与标题继承：优先从显式入参 > 挂起待审提案 > 声明工序列表
    const specs = this.getIntentToolSpecs();
    const targetToolName = args.targetTool || pendingProposal?.tool;
    const matchedSpec =
      specs.find((s) => s.toolName === targetToolName) ||
      specs.find((s) => s.toolName === args.targetTool) ||
      specs[0];
    const toolName = targetToolName || matchedSpec?.toolName;
    const title = args.title || pendingProposal?.title || matchedSpec?.title || '制片工序任务';

    // 【门禁 1 · 授权批准执行 (approve)】
    if (action === 'approve') {
      // 若此前并无挂起的待审提案且模型未给入参，自动降级为 propose 防止空参数物理执行报错
      if (!pendingProposal && (!args.params || Object.keys(args.params).length === 0)) {
        return {
          action: 'run_tool',
          tool: toolName,
          title,
          params: {
            projectId: this.projectId,
            ...(args.params || {}),
          },
          reasoning: args.reasoning,
          description: args.reasoning || matchedSpec?.description || `建议执行【${title}】`,
        };
      }

      // 自动无损继承前序待审提案中的完整参数，并与本次确认参数深度融合
      const finalParams = {
        ...(pendingProposal?.params || {}),
        ...(args.params || {}),
        projectId: this.projectId,
      };

      // 创作者已明确授权开跑，立即闭环关闭前序待审提案
      this.markProposalsResolved();

      return {
        action: 'approve',
        tool: toolName,
        title: pendingProposal?.title || title,
        params: finalParams,
        reasoning: args.reasoning || '创作者已授权同意执行当前工序',
        description: args.reasoning || `创作者已授权执行【${title}】`,
      };
    }

    // 【门禁 2 · 方案修改重塑 (modify)】
    if (action === 'modify') {
      const mergedParams = {
        ...(pendingProposal?.params || {}),
        ...(args.params || {}),
        projectId: this.projectId,
      };

      // 旧方案被重塑，关闭旧提案
      this.markProposalsResolved();

      return {
        action: 'run_tool',
        tool: toolName,
        title: `【修改方案】${title}`,
        params: mergedParams,
        reasoning: args.reasoning,
        description: args.reasoning || matchedSpec?.description || `已根据修改意见调整【${title}】制片参数`,
      };
    }

    // 【门禁 3 · 初次构思出具提案 (propose)】
    return {
      action: 'run_tool',
      tool: toolName,
      title,
      params: {
        projectId: this.projectId,
        ...(args.params || {}),
      },
      reasoning: args.reasoning,
      description: args.reasoning || matchedSpec?.description || `建议执行【${title}】`,
    };
  }
}
