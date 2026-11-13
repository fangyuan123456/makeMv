/**
 * client/src/lib/api.ts
 * 客户端标准 API 网关总线 (API Gateway SSOT)
 */

import type { ProjectMetadata, ProjectData, PlayerGameState, TextGameNode } from '../types/index.js';

const API_BASE = '/api';

export async function fetchProjects(): Promise<ProjectMetadata[]> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) {
    throw new Error(`获取项目列表失败: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchProject(projectId: string): Promise<ProjectData> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`);
  if (!res.ok) {
    throw new Error(`获取项目详情失败: ${res.statusText}`);
  }
  return res.json();
}

export async function startWorkflow(
  projectId: string,
  userPrompt: string,
  summary?: string
): Promise<{ runId: string; status: string }> {
  const res = await fetch(`${API_BASE}/workflow/${encodeURIComponent(projectId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userPrompt, ...(summary ? { summary } : {}) }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '启动流水线失败');
  }
  return data.data;
}

export async function resumeWorkflow(
  projectId: string,
  runId: string,
  decision: { approved: boolean; feedback?: string; summary?: string }
): Promise<any> {
  const res = await fetch(`${API_BASE}/workflow/${encodeURIComponent(projectId)}/${encodeURIComponent(runId)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '推进流水线失败');
  }
  return data.data;
}

export interface WorkflowStateSnapshot {
  runId: string;
  projectId: string;
  status: 'queued' | 'running' | 'suspended' | 'succeeded' | 'failed' | 'cancelled';
  currentStage: 'plan_gdd' | 'build_text_game' | 'compile_film' | 'completed';
  pendingApproval?: {
    type: 'gdd_approval' | 'lookdev_approval' | 'playtest_approval';
    title: string;
    description: string;
    data: any;
    validation?: { valid: boolean; errors: string[] };
  };
  error?: string;
}

export async function cancelWorkflow(
  projectId: string,
  runId: string,
  reason?: string
): Promise<WorkflowStateSnapshot> {
  const res = await fetch(
    `${API_BASE}/workflow/${encodeURIComponent(projectId)}/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reason ? { reason } : {}),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '取消流水线任务失败');
  }
  return data.data;
}

export async function getWorkflowState(
  projectId: string,
  runId: string
): Promise<WorkflowStateSnapshot> {
  const res = await fetch(`${API_BASE}/workflow/${encodeURIComponent(projectId)}/${encodeURIComponent(runId)}/state`);
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '查询流水线状态失败');
  }
  return data.data;
}

/** TaskStore 落盘快照：气泡进度条的唯一数据源 */
export interface TaskSnapshot {
  taskId: string;
  projectId: string;
  workflowKey: string;
  title: string;
  status: 'proposed' | 'queued' | 'running' | 'suspended' | 'succeeded' | 'failed' | 'cancelled';
  progress: { current: number; total: number; percent: number; note: string };
  requireConfirmation: boolean;
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchProjectTasks(projectId: string): Promise<TaskSnapshot[]> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(projectId)}`);
  if (!res.ok) {
    throw new Error(`获取项目任务列表失败: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchTask(projectId: string, taskId: string): Promise<TaskSnapshot> {
  const res = await fetch(
    `${API_BASE}/tasks/${encodeURIComponent(projectId)}/${encodeURIComponent(taskId)}`
  );
  if (!res.ok) {
    throw new Error(`查询任务进度失败: ${res.statusText}`);
  }
  return res.json();
}

/** 阶段二直接产出的独立可玩 index.html 游戏入口（走 /media 安全沙箱） */
export function buildGameUrl(projectId: string): string {
  return `/media/${encodeURIComponent(projectId)}/game-assembly/index.html`;
}

export async function initRuntimeGame(projectId: string): Promise<{ state: PlayerGameState; node: TextGameNode }> {
  const res = await fetch(`${API_BASE}/runtime/${encodeURIComponent(projectId)}/init`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '初始化文游试玩失败');
  }
  return data.data;
}

export async function stepRuntimeGame(
  projectId: string,
  currentState: PlayerGameState,
  choiceId: string
): Promise<{ state: PlayerGameState; node: TextGameNode }> {
  const res = await fetch(`${API_BASE}/runtime/${encodeURIComponent(projectId)}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentState, choiceId }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '推进文游剧情失败');
  }
  return data.data;
}

export async function fetchRuntimeGraph(projectId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/runtime/${encodeURIComponent(projectId)}/graph`);
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '获取图谱失败');
  }
  return data.data;
}
