/**
 * client/src/lib/ChatSession.ts
 * 客户端高内聚对话会话 SDK (Chat Session Client SSOT)
 *
 * 核心设计：
 * 1. 纯面向对象实例化：new ChatSession({ projectId, sessionId })；
 * 2. 多个对话天然解耦、独立存储、独立流式与提案管理；
 * 3. 强类型支持：派生出 PlannerChatSessionClient 等工序专属客户端。
 */

import { API_BASE } from './api.js';

export interface ChatMessageItem<TIntent = any> {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  proposal?: TIntent;
  proposalState?: 'pending' | 'running' | 'completed' | 'failed' | 'ignored';
  // ─── 任务绑定与真实生命周期契约 ───
  taskId?: string;
  taskTool?: string;
  taskTitle?: string;
  taskStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  taskProgress?: { current?: number; total?: number; message?: string; percent?: number };
  taskDurationMs?: number;
  taskOutputSummary?: string;
  taskError?: string;
  error?: string;
}

export interface StreamChatClientOptions<TIntent = any> {
  message: string;
  history?: Array<{ role: string; content: string }>;
  isSystemTrigger?: boolean;
  targetMessageId?: string;
  onTextChunk?: (chunk: string) => void;
  onDone?: (payload: { cleanText: string; intent?: TIntent | null; messageId?: string }) => void;
  onError?: (err: Error) => void;
}

export class ChatSession<TIntent = any> {
  public readonly projectId: string;
  public readonly sessionId: string;

  constructor(options?: { projectId?: string; sessionId?: string }) {
    this.projectId = options?.projectId || '';
    this.sessionId = options?.sessionId || 'default';
  }

  /**
   * 获取当前会话历史对白
   */
  public async getHistory(): Promise<ChatMessageItem<TIntent>[]> {
    if (!this.projectId) return [];

    const url = `${API_BASE}/chat/sessions/${encodeURIComponent(this.sessionId)}?projectId=${encodeURIComponent(this.projectId)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.success) {
      return [];
    }

    return (data.data || []).map((h: any) => ({
      id: h.id || `msg_${Math.random().toString(36).slice(2, 6)}`,
      role: h.role === 'user' ? 'user' : h.role === 'system' ? 'system' : 'assistant',
      content: h.content || '',
      createdAt: h.createdAt || new Date().toISOString(),
      proposal: h.proposal,
      proposalState: h.proposal ? (h.proposalResolved ? 'completed' : 'pending') : undefined,
      taskId: h.taskId,
      taskTool: h.taskTool,
      taskTitle: h.taskTitle,
      taskStatus: h.taskStatus,
      taskProgress: h.taskProgress,
      taskDurationMs: h.taskDurationMs,
      taskOutputSummary: h.taskOutputSummary,
      taskError: h.taskError,
    }));
  }

  /**
   * 原地更新会话中某条消息并落盘（如任务完成状态与结束消息追加）
   */
  public async updateMessage(
    messageId: string,
    patch: Partial<ChatMessageItem<TIntent>>
  ): Promise<ChatMessageItem<TIntent>[]> {
    if (!this.projectId) return [];

    const url = `${API_BASE}/chat/sessions/${encodeURIComponent(this.sessionId)}/messages/${encodeURIComponent(messageId)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: this.projectId,
        patch,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '更新消息失败');
    }
    return data.data || [];
  }

  /**
   * 向当前会话写入一条消息并刚性落盘（支持同时裁决待审提案）
   */
  public async appendMessage(
    message: Partial<ChatMessageItem<TIntent>> & { role: 'user' | 'assistant' | 'system'; content: string },
    resolveProposals?: boolean
  ): Promise<ChatMessageItem<TIntent>[]> {
    if (!this.projectId) return [];

    const url = `${API_BASE}/chat/sessions/${encodeURIComponent(this.sessionId)}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: this.projectId,
        message,
        resolveProposals,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '持久化消息失败');
    }
    return data.data || [];
  }

  /**
   * 标记当前会话所有未决提案为已解决
   */
  public async markProposalsResolved(): Promise<void> {
    if (!this.projectId) return;

    const url = `${API_BASE}/chat/sessions/${encodeURIComponent(this.sessionId)}/resolve`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: this.projectId }),
    });
  }

  /**
   * 启动当前会话单跳直出秒级流式推演
   */
  public async streamChat(options: StreamChatClientOptions<TIntent>): Promise<void> {
    if (!this.projectId) {
      options.onError?.(new Error('未选择有效项目'));
      return;
    }
    const { message, history, isSystemTrigger, targetMessageId, onTextChunk, onDone, onError } = options;
    const url = `${API_BASE}/chat/sessions/${encodeURIComponent(this.sessionId)}/stream`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: this.projectId,
          message,
          history,
          isSystemTrigger,
          targetMessageId,
        }),
      });

      if (!res.ok) {
        throw new Error(`会话推演请求失败: ${res.statusText}`);
      }
      if (!res.body) {
        throw new Error('未接收到服务端流式数据体');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'text' && typeof event.chunk === 'string') {
              onTextChunk?.(event.chunk);
            } else if (event.type === 'done') {
              onDone?.({
                cleanText: event.cleanText,
                intent: event.intent,
                messageId: event.messageId,
              });
            } else if (event.type === 'error') {
              onError?.(new Error(event.error || '会话推演出错'));
            }
          } catch {
            // 忽略碎片
          }
        }
      }
    } catch (err: any) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/**
 * 工序 1 故事总监专属客户端类 (继承通用 ChatSession，绑定工序 1 意图类型)
 */
export interface PlannerActionIntent {
  action: 'run_tool' | 'approve' | 'modify' | 'next_stage';
  tool?: string;
  stage?: string;
  title: string;
  params?: Record<string, any>;
  description?: string;
  reasoning?: string;
}

export class PlannerChatSessionClient extends ChatSession<PlannerActionIntent> {
  constructor(projectId?: string, sessionId: string = 'planner') {
    super({ projectId: projectId || '', sessionId });
  }
}

/**
 * 工序 2-A: 定妆空间机器人专属客户端类 (视觉定妆：角色与场景)
 */
export interface LookdevActionIntent {
  action: 'run_tool';
  tool?: string;
  title: string;
  params?: Record<string, any>;
  description?: string;
}

export class LookdevChatSessionClient extends ChatSession<LookdevActionIntent> {
  constructor(projectId?: string, sessionId: string = 'lookdev') {
    super({ projectId: projectId || '', sessionId });
  }
}

/**
 * 工序 2-B: 分幕专属分镜总导演客户端类 (分镜台本：戏剧节拍与运镜)
 */
export interface StoryboardActionIntent {
  action: 'run_tool';
  tool?: string;
  title: string;
  params?: Record<string, any>;
  description?: string;
}

export class StoryboardChatSessionClient extends ChatSession<StoryboardActionIntent> {
  public readonly clipId?: string;

  constructor(projectId?: string, clipId?: string) {
    const sid = clipId ? `storyboard_${clipId}` : 'storyboard';
    super({ projectId: projectId || '', sessionId: sid });
    this.clipId = clipId;
  }
}
