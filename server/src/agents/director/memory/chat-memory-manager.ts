/**
 * agents/director/memory/chat-memory-manager.ts
 * AI 视听总导演微观工作记忆管理器 (Chat Working Memory Manager SSOT)
 *
 * 核心设计（法典 2.4 双轨记忆微架构）：
 * 1. 严格契约保障：截取的多轮会话历史首条消息 100% 保障为 user 角色，杜绝大模型 API 报 400 Bad Request；
 * 2. 角色严格交替：自动对相邻同角色连续消息进行规范合并，保障 user <-> assistant 严格交替；
 * 3. 异常中断补录：流式生成中断或异常崩溃时，自动补录占位 assistant 消息，保障会话结构完整无缝；
 * 4. 高内聚微内核：将微观工作记忆逻辑从 HTTP 路由与控制器中彻底剥离，单一事实来源。
 */

import { ProjectStore } from '../../../project-store/ProjectStore.js';

export interface WorkingTurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class ChatMemoryManager {
  private static instance?: ChatMemoryManager;

  public static getInstance(): ChatMemoryManager {
    if (!ChatMemoryManager.instance) {
      ChatMemoryManager.instance = new ChatMemoryManager();
    }
    return ChatMemoryManager.instance;
  }

  /**
   * 为指定项目的会话提取高信噪比、严格合规的多轮工作记忆上下文
   *
   * @param projectId 项目唯一标识
   * @param sessionId 会话标识
   * @param maxTurns 截取的最大消息条数（默认 10）
   * @param fallbackUserPrompt 若历史为空时的首条兜底提示
   */
  public getWorkingTurns(
    projectId: string,
    sessionId: string,
    maxTurns: number = 10,
    fallbackUserPrompt: string = '请根据当前项目进展提出导演专业建议'
  ): WorkingTurnMessage[] {
    const store = ProjectStore.getInstance();
    const storedMessages = store.getMessages(projectId, sessionId) || [];

    // 1. 基础纯净化过滤：仅保留具备有效文本内容的 user 与 assistant 消息
    const validMessages: WorkingTurnMessage[] = storedMessages
      .filter(
        (m: any) =>
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0
      )
      .map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.trim(),
      }));

    if (validMessages.length === 0) {
      return [{ role: 'user', content: fallbackUserPrompt }];
    }

    // 2. 截取最近窗口
    let windowed = validMessages.slice(-maxTurns);

    // 3. 🌟 刚性首条保障：首条必须为 'user'
    // 若截取窗口的第一条刚好是 'assistant'，主动向后修剪，直至找到第一个 'user' 消息
    const firstUserIndex = windowed.findIndex((m) => m.role === 'user');
    if (firstUserIndex === -1) {
      // 极端兜底：窗口内全为 assistant，则前置插入 fallbackUserPrompt
      windowed = [{ role: 'user', content: fallbackUserPrompt }, ...windowed];
    } else if (firstUserIndex > 0) {
      // 丢弃前面多余的 assistant 消息
      windowed = windowed.slice(firstUserIndex);
    }

    // 4. 🌟 严格交替保障与相邻同角色折叠
    // 若存在连续同角色（如连续两条 user），将内容平滑合并，确保严格的 user <-> assistant 乒乓交替
    const sanitizedTurns: WorkingTurnMessage[] = [];
    for (const msg of windowed) {
      const lastMsg = sanitizedTurns[sanitizedTurns.length - 1];
      if (lastMsg && lastMsg.role === msg.role) {
        // 合并连续同角色内容
        lastMsg.content = `${lastMsg.content}\n${msg.content}`;
      } else {
        sanitizedTurns.push({ role: msg.role, content: msg.content });
      }
    }

    return sanitizedTurns.length > 0
      ? sanitizedTurns
      : [{ role: 'user', content: fallbackUserPrompt }];
  }

  /**
   * 当流式生成异常中断时，自动补录占位 assistant 消息保障会话轮次严格完整
   */
  public recordAssistantFallback(
    projectId: string,
    sessionId: string,
    errorReason?: string
  ): void {
    const store = ProjectStore.getInstance();
    const fallbackReply = `[导演思考被中断: ${errorReason || '流式连接异常'}，请重试或继续下发指令]`;
    const fallbackAssistantMsg = {
      role: 'assistant',
      content: fallbackReply,
      timestamp: new Date().toISOString(),
    };
    store.appendMessage(projectId, sessionId, fallbackAssistantMsg as any);
  }
}
