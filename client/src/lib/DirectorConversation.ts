/**
 * client/src/lib/DirectorConversation.ts
 * 导演对话的客户端传输封装。
 *
 * 核心设计：
 * 1. 纯面向对象实例化：new DirectorConversationClient({ projectId, sessionId })；
 * 2. 多个对话天然解耦、独立存储、独立流式与提案管理；
 * 3. 按工序提供专属客户端类型。
 */

import { API_BASE } from './api.js';

export interface PlanStepRecord {
  stepIndex: number;
  taskId: string;
  tool: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: { current?: number; total?: number; message?: string; percent?: number };
  durationMs?: number;
  error?: string;
}

export interface ChatImageAttachment {
  url: string;
  name?: string;
}

export interface ConversationMessage<TIntent = any> {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 开跑前言对白（方案锁定、授权开跑时的前置说明，与卡片上方对白绑定） */
  leadInSpeech?: string;
  /** 任务全部物理落盘后出具的阶段复盘对白（与卡片下方对白绑定） */
  postSummarySpeech?: string;
  attachments?: ChatImageAttachment[];
  createdAt: string;
  proposal?: TIntent;
  proposalResolved?: boolean;
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
  planSteps?: PlanStepRecord[];
  metadata?: Record<string, any>;
  error?: string;
}

export interface AgentFocusTarget {
  kind: string;
  id: string;
  label: string;
  subview?: string;
}

export interface AgentFocusContext {
  location: string;
  target?: AgentFocusTarget;
  meta?: Record<string, string | number | boolean | undefined>;
}

export interface StreamConversationOptions {
  message: string;
  attachments?: ChatImageAttachment[];
  focus?: AgentFocusContext;
  onTextChunk?: (chunk: string) => void;
  onDone?: () => void | Promise<void>;
  onError?: (err: Error) => void;
}

export class DirectorConversationClient<TIntent = any> {
  public readonly projectId: string;
  public readonly sessionId: string;

  constructor(options?: { projectId?: string; sessionId?: string }) {
    this.projectId = options?.projectId || '';
    this.sessionId = options?.sessionId || 'default';
  }

  /**
   * 获取当前会话历史对白 (增强容错：防御服务端重启或离线时的网络异常)
   */
  public async getHistory(): Promise<ConversationMessage<TIntent>[]> {
    if (!this.projectId) return [];

    try {
      const url = `${API_BASE}/chat/sessions/${encodeURIComponent(this.sessionId)}?projectId=${encodeURIComponent(this.projectId)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`获取会话历史失败: ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '获取会话历史失败');

      return (data.data || []).map((h: any) => ({
        id: h.id || `msg_${Math.random().toString(36).slice(2, 6)}`,
        role: h.role === 'user' ? 'user' : h.role === 'system' ? 'system' : 'assistant',
        content: h.content || '',
        leadInSpeech: h.leadInSpeech,
        postSummarySpeech: h.postSummarySpeech,
        attachments: Array.isArray(h.attachments) ? h.attachments : undefined,
        createdAt: h.createdAt || new Date().toISOString(),
        proposal: h.proposal,
        proposalResolved: h.proposalResolved,
        proposalState: h.proposal ? (h.proposalResolved ? 'completed' : 'pending') : undefined,
        taskId: h.taskId,
        taskTool: h.taskTool,
        taskTitle: h.taskTitle,
        taskStatus: h.taskStatus,
        taskProgress: h.taskProgress,
        taskDurationMs: h.taskDurationMs,
        taskOutputSummary: h.taskOutputSummary,
        taskError: h.taskError,
        planSteps: Array.isArray(h.planSteps) ? h.planSteps : undefined,
        metadata: h.metadata,
      }));
    } catch (err) {
      console.warn(`[DirectorConversation:${this.sessionId}] 获取历史网络异常:`, err);
      throw err;
    }
  }

  public async approveProposal(proposalId: string): Promise<void> {
    const url = `${API_BASE}/chat/sessions/${encodeURIComponent(this.sessionId)}/proposals/${encodeURIComponent(proposalId)}/approve`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: this.projectId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '批准提案失败');
  }

  public async uploadChatImage(file: File): Promise<ChatImageAttachment> {
    if (!this.projectId) throw new Error('未选择有效项目');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片文件失败'));
      reader.readAsDataURL(file);
    });
    const res = await fetch(`${API_BASE}/chat/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: this.projectId,
        filename: file.name || `paste_${Date.now()}.png`,
        dataUrl,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success || !data.data?.url) {
      throw new Error(data.error || '上传聊天图片失败');
    }
    return { url: data.data.url, name: data.data.name || file.name };
  }

  /**
   * 启动当前会话单跳直出秒级流式推演
   */
  public async streamMessage(options: StreamConversationOptions): Promise<void> {
    if (!this.projectId) {
      options.onError?.(new Error('未选择有效项目'));
      return;
    }
    const { message, attachments, focus, onTextChunk, onDone, onError } = options;
    const url = `${API_BASE}/chat/sessions/${encodeURIComponent(this.sessionId)}/stream`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: this.projectId,
          message,
          ...(attachments?.length ? { attachments } : {}),
          ...(focus ? { focus } : {}),
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
      let receivedDone = false;

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
          let event: any;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }
          if (event.type === 'text' && typeof event.chunk === 'string') {
            onTextChunk?.(event.chunk);
          } else if (event.type === 'done') {
            receivedDone = true;
            await onDone?.();
          } else if (event.type === 'error') {
            throw new Error(event.error || '会话推演出错');
          }
        }
      }
      if (!receivedDone) throw new Error('会话流已中断，未收到完成事件');
    } catch (err: any) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/**
 * 全系统对话生命周期统一意图基类契约 (SSOT)
 */
export interface BaseActionIntent {
  action: 'propose' | 'approve' | 'modify' | 'chat_only';
  tool?: string;
  stage?: string;
  title: string;
  params?: Record<string, any>;
  operations?: Array<{
    tool?: string;
    targetTool?: string;
    title?: string;
    params: Record<string, any>;
  }>;
  coverage?: string;
  description?: string;
  reasoning?: string;
  reply?: string;
}

/**
 * 工序 1 故事总监专属客户端。
 */
export type PlannerActionIntent = BaseActionIntent;

export class PlannerConversationClient extends DirectorConversationClient<PlannerActionIntent> {
  constructor(projectId?: string, sessionId: string = 'planner') {
    super({ projectId: projectId || '', sessionId });
  }
}

/**
 * 工序 2-A: 定妆空间机器人专属客户端类 (视觉定妆：角色与场景)
 */
export type LookdevActionIntent = BaseActionIntent;

export class LookdevConversationClient extends DirectorConversationClient<LookdevActionIntent> {
  constructor(projectId?: string, sessionId: string = 'lookdev') {
    super({ projectId: projectId || '', sessionId });
  }
}

/**
 * 工序 2-B: 分幕专属分镜总导演客户端类 (分镜台本：戏剧节拍与运镜)
 */
export type StoryboardActionIntent = BaseActionIntent;

export class StoryboardConversationClient extends DirectorConversationClient<StoryboardActionIntent> {
  public readonly clipId?: string;

  constructor(projectId?: string, clipId?: string) {
    const sid = clipId ? `storyboard_${clipId}` : 'storyboard';
    super({ projectId: projectId || '', sessionId: sid });
    this.clipId = clipId;
  }
}

/**
 * 工序 3: 游戏总装与调优专属客户端类 (互动影游独立站点装配与微调)
 */
export type GameAssemblyActionIntent = BaseActionIntent;

export class GameAssemblyConversationClient extends DirectorConversationClient<GameAssemblyActionIntent> {
  constructor(projectId?: string, sessionId: string = 'game') {
    super({ projectId: projectId || '', sessionId });
  }
}
