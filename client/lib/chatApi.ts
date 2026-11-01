/**
 * client/lib/chatApi.ts
 * 现代 AI 导演双核智能体与声明式工序技能流式交互客户端 (Chat API SSOT)
 */

export const DIRECT_API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export type ActionProposalStatus = 'pending' | 'executed' | 'dismissed';

export interface ActionProposal {
  actionId: string;
  actionType: string;
  skill?: string;
  label: string;
  description: string;
  status: ActionProposalStatus; // 🌟 显式状态机 (pending | executed | dismissed)
  payload?: Record<string, any>;
  executedAt?: string;
  resultSummary?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  actionProposal?: ActionProposal;
  createdAt: string;
}

export interface ChatSession {
  sessionId: string;
  projectId: string;
  title: string;
  currentStage: string;
  scratchpad: {
    themeAndStyle?: string;
    logline?: string;
    charactersSummary?: string;
    storySpine?: string;
    userConstraints?: string[];
    lastUpdatedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ReviewIssue {
  id?: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  dimension: 'LOGIC' | 'CHARACTER' | 'INTERACTIVE' | 'VISUAL';
  location: string;
  description: string;
  suggestion: string;
}

export interface ReviewReport {
  projectName: string;
  stageReviewed: string;
  gateStatus: 'PASS' | 'WARN' | 'FAIL';
  scores: {
    narrativeLogicScore: number;
    characterDepthScore: number;
    branchTensionScore: number;
    visualFeasibilityScore: number;
    overallScore: number;
  };
  thoughtChain: string;
  crossStageInsights?: {
    characterConsistency: string;
    branchValidity: string;
    visualFeasibility: string;
  };
  criticalFlaws: ReviewIssue[];
  polishSuggestions: string[];
  verdict: string;
  reviewedAt: string;
}

export interface CriticDialogReply {
  reply: string;
  isDefenseAccepted?: boolean;
  reassessedGateStatus?: 'PASS' | 'WARN' | 'FAIL';
  adjustedFlaws?: ReviewIssue[];
}

export interface DirectorStreamCallbacks {
  onToken?: (token: string) => void;
  onThought?: (thought: string) => void;
  onProposal?: (proposal: ActionProposal) => void;
  onDone?: (result: { message: ChatMessage; proposal?: ActionProposal }) => void;
  onError?: (error: Error) => void;
}

export interface SkillStreamCallbacks {
  onProgress?: (percent: number, message: string) => void;
  onDone?: (result: any) => void;
  onError?: (error: Error) => void;
}

/**
 * 通用 SSE 事件流解析器
 */
async function parseSseStream(
  response: Response,
  onEvent: (event: string, data: any) => void
): Promise<void> {
  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';

    for (const block of blocks) {
      if (!block.trim()) continue;

      let currentEvent = 'message';
      let currentData = '';

      const lines = block.split('\n');
      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.replace('event:', '').trim();
        } else if (line.startsWith('data:')) {
          const content = line.replace('data:', '').trim();
          currentData = currentData ? `${currentData}\n${content}` : content;
        }
      }

      if (currentData) {
        try {
          const parsed = JSON.parse(currentData);
          onEvent(currentEvent, parsed);
        } catch {
          onEvent(currentEvent, currentData);
        }
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    let currentEvent = 'message';
    let currentData = '';
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.replace('event:', '').trim();
      } else if (line.startsWith('data:')) {
        const content = line.replace('data:', '').trim();
        currentData = currentData ? `${currentData}\n${content}` : content;
      }
    }
    if (currentData) {
      try {
        const parsed = JSON.parse(currentData);
        onEvent(currentEvent, parsed);
      } catch {
        onEvent(currentEvent, currentData);
      }
    }
  }
}

/**
 * 获取项目的所有会话列表
 */
export async function fetchChatSessions(projectId: string): Promise<ChatSession[]> {
  const resp = await fetch(`/api/chat/${projectId}/sessions`);
  if (!resp.ok) return [];
  const json = await resp.json().catch(() => ({}));
  return json.sessions || [];
}

/**
 * 创建新会话
 */
export async function createChatSession(
  projectId: string,
  title: string = '主线创作会话',
  initialStage: string = 'narrative_design'
): Promise<ChatSession> {
  const resp = await fetch(`/api/chat/${projectId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, initialStage }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '创建会话失败' }));
    throw new Error(err.error || '创建会话失败');
  }
  const json = await resp.json();
  return json.session;
}

/**
 * 获取指定会话的历史消息
 */
export async function fetchChatMessages(projectId: string, sessionId: string): Promise<ChatMessage[]> {
  const resp = await fetch(`/api/chat/${projectId}/sessions/${sessionId}/messages`);
  if (!resp.ok) return [];
  const json = await resp.json().catch(() => ({}));
  return json.messages || [];
}

/**
 * 🌟 显式废弃/忽略提案 (Dismiss ActionProposal)
 */
export async function dismissChatProposal(
  projectId: string,
  sessionId: string,
  actionId: string
): Promise<boolean> {
  const resp = await fetch(`/api/chat/${projectId}/proposals/${actionId}/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!resp.ok) return false;
  const json = await resp.json().catch(() => ({}));
  return !!json.success;
}

/**
 * 🌟 与独立影视审查官对辩与质询 (Critic Debate Dialog)
 */
export async function sendCriticReviewDialog(
  projectId: string,
  userMessage: string,
  targetStage?: string,
  sessionId?: string
): Promise<CriticDialogReply> {
  const resp = await fetch(`/api/chat/${projectId}/reviewer/dialog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userMessage, targetStage, sessionId }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: '审查官对辩请求失败' }));
    throw new Error(err.error || '审查官对辩请求失败');
  }
  return resp.json();
}

/**
 * 🌟 核心流式对话推进 (直连 DirectorAgent SSE 流式真打字机)
 */
export async function streamDirectorChat(
  projectId: string,
  sessionId: string,
  content: string,
  callbacks: DirectorStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const url = `${DIRECT_API_BASE}/api/chat/${projectId}/stream`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, content }),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    const err = new Error(`流式对话请求失败 (HTTP ${resp.status}): ${errText}`);
    callbacks.onError?.(err);
    throw err;
  }

  await parseSseStream(resp, (event, data) => {
    switch (event) {
      case 'token':
        callbacks.onToken?.(data.token || '');
        break;
      case 'thought':
        callbacks.onThought?.(data.thought || '');
        break;
      case 'proposal':
        callbacks.onProposal?.(data);
        break;
      case 'done':
        callbacks.onDone?.(data);
        break;
      case 'error':
        callbacks.onError?.(new Error(data.error || 'Director execution failed'));
        break;
    }
  });
}

/**
 * 🌟 核心声明式工序技能执行 (直连 SkillController SSE 进度流)
 * 严格遵从法典 0.4：显式透传 actionId，消灭服务端模糊盲猜与回退
 */
export async function streamSkillExecute(
  projectId: string,
  skillName: string,
  sessionId: string | undefined,
  params: Record<string, any> = {},
  callbacks: SkillStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const url = `${DIRECT_API_BASE}/api/chat/${projectId}/skill/execute`;
  const actionId = params.actionId; // 显式顶层抽取透传

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skillName,
      sessionId,
      actionId,
      params,
    }),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    const err = new Error(`工序技能执行请求失败 (HTTP ${resp.status}): ${errText}`);
    callbacks.onError?.(err);
    throw err;
  }

  await parseSseStream(resp, (event, data) => {
    switch (event) {
      case 'progress':
        callbacks.onProgress?.(data.percent ?? 0, data.message || '');
        break;
      case 'done':
        callbacks.onDone?.(data);
        break;
      case 'error':
        callbacks.onError?.(new Error(data.error || 'Skill execution failed'));
        break;
    }
  });
}
