/**
 * client/src/lib/api.ts
 * 客户端标准 API 网关总线 (API Gateway SSOT)
 *
 * 纯 Tool-First 架构，消灭旧时代流水线与对话流僵尸接口
 */

import type {
  ProjectMetadata,
  ProjectData,
  TaskRecord,
  ToolMetadata,
  StoryboardCanvasData,
} from '../types/index.js';

export const API_BASE = '/api';

/**
 * 获取所有项目列表
 */
export async function fetchProjects(): Promise<ProjectMetadata[]> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) {
    throw new Error(`获取项目列表失败: ${res.statusText}`);
  }
  return res.json();
}

/**
 * 创建新项目
 */
export async function createProject(title?: string, genre?: string): Promise<ProjectMetadata> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, genre }),
  });
  if (!res.ok) {
    throw new Error(`创建项目失败: ${res.statusText}`);
  }
  return res.json();
}

/**
 * 获取指定项目详情与全部资产
 */
export async function fetchProject(projectId: string): Promise<ProjectData> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`);
  if (!res.ok) {
    throw new Error(`获取项目详情失败: ${res.statusText}`);
  }
  return res.json();
}

/**
 * 阶段四直接产出的独立可玩 index.html 游戏入口（走 /media 安全沙箱）
 */
export function buildGameUrl(projectId: string): string {
  return `/media/${encodeURIComponent(projectId)}/game-assembly/index.html`;
}

/**
 * 现代 Tool-First 任务调度：派发执行指定工具 (立即返回 pending 态 TaskRecord)
 */
export async function runTask(
  projectId: string,
  toolName: string,
  input: Record<string, any>
): Promise<TaskRecord> {
  const res = await fetch(`${API_BASE}/tasks/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, toolName, input }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `派发任务 [${toolName}] 失败`);
  }
  return data.data;
}

/**
 * 取消正在执行的任务
 */
export async function cancelTask(taskId: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
  });
  const data = await res.json();
  return Boolean(res.ok && data.success);
}

/**
 * 查询指定项目下的所有任务历史
 */
export async function fetchTasks(projectId: string): Promise<TaskRecord[]> {
  const res = await fetch(`${API_BASE}/tasks?projectId=${encodeURIComponent(projectId)}`);
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '获取任务列表失败');
  }
  return data.data;
}

/**
 * 查询单个任务详情
 */
export async function fetchTaskRecord(taskId: string): Promise<TaskRecord> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}`);
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `获取任务 [${taskId}] 失败`);
  }
  return data.data;
}

/**
 * 查询系统已注册的全部任务工具元数据
 */
export async function fetchTools(): Promise<ToolMetadata[]> {
  const res = await fetch(`${API_BASE}/tools`);
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '获取工具列表失败');
  }
  return data.data;
}

export interface StreamPlannerChatOptions {
  projectId: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  isSystemTrigger?: boolean;
  onTextChunk?: (chunk: string) => void;
  onDone?: (payload: { cleanText: string; intent?: any }) => void;
  onError?: (err: Error) => void;
}

/**
 * 启动工序 1 专职故事总监流式推演对话
 */
export async function streamPlannerChat(options: StreamPlannerChatOptions): Promise<void> {
  const { projectId, message, history, isSystemTrigger, onTextChunk, onDone, onError } = options;

  try {
    const res = await fetch(`${API_BASE}/chat/planner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, message, history, isSystemTrigger }),
    });

    if (!res.ok) {
      throw new Error(`故事总监请求失败: ${res.statusText}`);
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
            });
          } else if (event.type === 'error') {
            onError?.(new Error(event.error || '故事总监对话推演出错'));
          }
        } catch {
          // 忽略格式解析残片
        }
      }
    }
  } catch (err: any) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * 获取工序 1 故事总监历史会话 (已代理至 ChatSession 通用会话通道)
 */
export async function fetchPlannerChatHistory(projectId: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/chat/sessions/planner?projectId=${encodeURIComponent(projectId)}`);
  const data = await res.json();
  if (!res.ok || !data.success) {
    return [];
  }
  return data.data || [];
}

export * from './ChatSession.js';

/**
 * 获取视听分镜无限画布拓扑数据
 */
export async function fetchStoryboardCanvas(projectId: string): Promise<StoryboardCanvasData> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/canvas/storyboard`);
  if (!res.ok) {
    throw new Error(`获取分镜画布失败: ${res.statusText}`);
  }
  return res.json();
}

/**
 * 保存分镜画布拓扑数据 (轻量坐标与连线同步)
 */
export async function saveStoryboardCanvas(
  projectId: string,
  canvasData: StoryboardCanvasData
): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/canvas/storyboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(canvasData),
  });
  if (!res.ok) {
    throw new Error(`保存分镜画布失败: ${res.statusText}`);
  }
}

/**
 * 切换分镜节点当前激活候选视频
 */
export async function selectCanvasCandidate(
  projectId: string,
  nodeId: string,
  taskId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/canvas/storyboard/select-candidate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId, taskId }),
    }
  );
  if (!res.ok) {
    throw new Error(`切换候选视频失败: ${res.statusText}`);
  }
}

/**
 * 上传角色或场景的垫图参考图
 */
export async function uploadReferenceImage(
  projectId: string,
  entityType: 'character' | 'location',
  entityId: string,
  file: File
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/upload-reference`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            dataUrl,
            entityType,
            entityId,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || '上传参考图失败');
        }
        resolve(data.mediaUrl);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * 实时更新实体属性（微调提示词或垫图）
 */
export async function updateEntity(
  projectId: string,
  entityType: 'character' | 'location',
  entityId: string,
  updates: { promptZh?: string; referenceImageUrl?: string }
): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/entities/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entityType,
      entityId,
      updates,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '更新实体属性失败');
  }
}

/**
 * 手动切换定妆激活版本
 */
export async function selectEntityVersion(
  projectId: string,
  entityType: 'character' | 'location',
  entityId: string,
  versionId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/entities/select-version`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType,
        entityId,
        versionId,
      }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '切换定妆版本失败');
  }
}

/**
 * 基于当前立绘图的 AI 定向精修 (Image-to-Image / Ref2Image)
 * 严格锁定人物五官身材，仅定向修改服饰/发型/色彩并自动出图
 */
export async function imageRefineEntity(
  projectId: string,
  entityType: 'character' | 'location',
  entityId: string,
  instruction: string,
  baseImageUrl?: string
): Promise<{ success: boolean; directedPrompt: string; baseImageUrl: string; task?: TaskRecord }> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/entities/image-refine`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType,
        entityId,
        instruction,
        baseImageUrl,
      }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '基于当前图定向精修失败');
  }
  return data;
}
