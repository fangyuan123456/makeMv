/**
 * client/src/lib/mastra.ts
 * 基于 @mastra/client-js 的前端统一服务连接器与 Mastra Studio 通信总线 (SSOT)
 */

import { MastraClient } from '@mastra/client-js';
import type { ActionProposal } from '../components/studio/studio.types';

export const MASTRA_SERVER_URL = import.meta.env.VITE_MASTRA_SERVER_URL || 'http://localhost:4111';

// Mastra 官方统一客户端单例
export const mastraClient = new MastraClient({
  baseUrl: MASTRA_SERVER_URL,
});

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  type: 'pipeline' | 'subworkflow';
  stepsCount: number;
  stepIds: string[];
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

export interface StreamChatCallbacks {
  onMeta?: (meta: { projectId: string; sessionId?: string }) => void;
  onChunk?: (chunk: string) => void;
  onThought?: (thought: string) => void;
  onProposal?: (proposal: ActionProposal) => void;
  onComplete?: (fullText: string) => void;
  onError?: (err: any) => void;
}

/**
 * Mastra Studio 业务门面服务 (MastraStudioApi SSOT)
 */
export const mastraStudioApi = {
  // 1. 服务健康检测
  async checkHealth(): Promise<{ online: boolean; service?: string }> {
    try {
      const res = await fetch(`${MASTRA_SERVER_URL}/health`);
      if (res.ok) {
        const data = await res.json();
        return { online: true, service: data.service };
      }
      return { online: false };
    } catch {
      return { online: false };
    }
  },

  // 2. 获取微内核智能体清单
  async getAgents(): Promise<AgentSummary[]> {
    try {
      const res = await fetch(`${MASTRA_SERVER_URL}/api/agents`);
      if (res.ok) {
        const data = await res.json();
        return data.agents || [];
      }
      return [];
    } catch {
      return [];
    }
  },

  // 3. 获取微内核工作流全景拓扑 (包含宏观流水线与三大微观子工作流)
  async getWorkflows(): Promise<WorkflowSummary[]> {
    try {
      const res = await fetch(`${MASTRA_SERVER_URL}/api/workflows`);
      if (res.ok) {
        const data = await res.json();
        return data.workflows || [];
      }
      return [];
    } catch {
      return [];
    }
  },

  // 4. 获取指定工作流步骤详情
  async getWorkflowDetail(workflowId: string): Promise<any> {
    try {
      const res = await fetch(`${MASTRA_SERVER_URL}/api/workflows/${encodeURIComponent(workflowId)}`);
      if (res.ok) {
        const data = await res.json();
        return data.workflow;
      }
      return null;
    } catch {
      return null;
    }
  },

  // 5. 项目列表
  async getProjects(): Promise<any[]> {
    const res = await fetch(`${MASTRA_SERVER_URL}/api/projects`);
    if (!res.ok) throw new Error(`获取项目列表失败: HTTP ${res.status}`);
    const data = await res.json();
    return data.projects || [];
  },

  // 6. 项目详情与工序资产
  async getProject(projectId: string): Promise<any> {
    const res = await fetch(`${MASTRA_SERVER_URL}/api/projects/${projectId}`);
    if (!res.ok) throw new Error(`获取项目 [${projectId}] 失败: HTTP ${res.status}`);
    const data = await res.json();
    return data.project || data;
  },

  // 7. 新建项目
  async createProject(params?: { title?: string; idea?: string; style?: string; videoRatio?: string }): Promise<any> {
    const res = await fetch(`${MASTRA_SERVER_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || { title: '全新互动影游创作' }),
    });
    if (!res.ok) throw new Error(`创建项目失败: HTTP ${res.status}`);
    const data = await res.json();
    return data.project || data;
  },

  // 8. 删除项目
  async deleteProject(projectId: string): Promise<void> {
    const res = await fetch(`${MASTRA_SERVER_URL}/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`删除项目失败: HTTP ${res.status}`);
  },

  // 9. 获取提案列表 (细粒度进度轮询)
  async getProposals(projectId: string): Promise<ActionProposal[]> {
    const res = await fetch(`${MASTRA_SERVER_URL}/api/projects/${projectId}/proposals`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.proposals || [];
  },

  // 10. 批准执行提案 (人在回路仲裁)
  async approveProposal(proposalId: string, overrides?: Record<string, any>): Promise<any> {
    const res = await fetch(`${MASTRA_SERVER_URL}/api/proposals/${proposalId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides }),
    });
    if (!res.ok) throw new Error(`批准提案失败: HTTP ${res.status}`);
    return await res.json();
  },

  // 11. 驳回提案
  async rejectProposal(proposalId: string): Promise<any> {
    const res = await fetch(`${MASTRA_SERVER_URL}/api/proposals/${proposalId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`驳回提案失败: HTTP ${res.status}`);
    return await res.json();
  },

  // 12. 统一流式对话通道 (自由对话 + SSE 流式打字机 + 意图提案实时拦截)
  async streamChat(
    projectId: string,
    message: string,
    callbacks: StreamChatCallbacks
  ): Promise<void> {
    const res = await fetch(`${MASTRA_SERVER_URL}/api/chat?stream=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ projectId, message }),
    });

    if (!res.ok) {
      throw new Error(`对话请求失败: HTTP ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('流式读取器初始化失败');

    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const data = JSON.parse(jsonStr);

            // 0. 项目与会话元数据首帧通知
            if (data.type === 'meta' && data.projectId) {
              callbacks.onMeta?.({ projectId: data.projectId, sessionId: data.sessionId });
            }
            // 1. 思考推演流
            if (data.type === 'thought' && data.thought) {
              callbacks.onThought?.(data.thought);
            }
            // 2. 文本增量切片
            if (data.type === 'chunk' && data.content) {
              accumulatedText += data.content;
              callbacks.onChunk?.(accumulatedText);
            }
            // 3. 行动提案协议拦截
            if (data.type === 'proposal' && data.proposal) {
              callbacks.onProposal?.(data.proposal);
            }
            // 4. 对话完成事件
            if (data.type === 'done') {
              if (data.finalProposal) {
                callbacks.onProposal?.(data.finalProposal);
              }
              if (data.fullText) {
                accumulatedText = data.fullText;
                callbacks.onChunk?.(accumulatedText);
              }
            }
          } catch {}
        }
      }
      callbacks.onComplete?.(accumulatedText);
    } catch (err) {
      callbacks.onError?.(err);
      throw err;
    }
  },
};
