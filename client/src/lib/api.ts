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
  ReviewFreshnessView,
} from '../types/index.js';

export const API_BASE = '/api';

/**
 * 健壮的响应体解析辅助函数：防御空响应体与非 JSON 错误，避免抛出 Unexpected end of JSON input
 */
async function parseResponseJson<T = any>(res: Response, fallbackError: string): Promise<T> {
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // 容错：非合法 JSON
    }
  }
  if (!res.ok) {
    const errorMsg = data?.error || data?.message || (text && text.length < 200 ? text : `服务未正常响应 (${res.status} ${res.statusText})`);
    throw new Error(errorMsg || fallbackError);
  }
  if (data && typeof data === 'object' && data.success === false) {
    throw new Error(data.error || fallbackError);
  }
  return (data ?? {}) as T;
}

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
 * 保存手动编辑后的剧本正文（不自动触发大模型重审，自动比对指纹标脏）
 */
export async function saveScreenplay(
  projectId: string,
  screenplay: string
): Promise<{ success: boolean; screenplay: string; screenplayReview: ReviewFreshnessView }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/screenplay`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ screenplay }),
  });
  const data = await parseResponseJson(res, '保存剧本失败');
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || '保存剧本失败');
  }
  return data;
}

/**
 * 手动触发剧本质量审查
 */
export async function triggerScreenplayReview(
  projectId: string,
  screenplay?: string
): Promise<{ success: boolean; screenplayReview: ReviewFreshnessView }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/screenplay/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ screenplay }),
  });
  const data = await parseResponseJson(res, '触发剧本审查失败');
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || '触发剧本审查失败');
  }
  return data;
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

/** 重试失败或取消的任务 */
export async function retryTask(taskId: string): Promise<TaskRecord> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/retry`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `重试任务 [${taskId}] 失败`);
  }
  return data.data;
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

export * from './DirectorConversation.js';

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
  entityType: 'character' | 'location' | 'item',
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
  entityType: 'character' | 'location' | 'item',
  entityId: string,
  updates: {
    promptZh?: string;
    referenceImageUrl?: string;
    appearanceSummary?: string;
    atmosphere?: string;
    spatialLayout?: string;
  }
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
  entityType: 'character' | 'location' | 'item',
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
  await parseResponseJson(res, '切换定妆版本失败');
}

/**
 * 基于当前立绘图的 AI 定向精修 (Image-to-Image / Ref2Image)
 * 严格锁定人物五官身材，仅定向修改服饰/发型/色彩并自动出图
 */
export async function imageRefineEntity(
  projectId: string,
  entityType: 'character' | 'location' | 'item',
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

/** 切换镜头首/末帧或视频的历史版本（与定妆版本库同款玩法） */
export async function selectShotVersion(
  projectId: string,
  shotId: string,
  frame: 'first' | 'last' | 'video',
  versionId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/shots/select-version`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shotId, frame, versionId }),
    }
  );
  await parseResponseJson(res, '切换镜头版本失败');
}

/** 保存镜头首/末帧/视频的提示词 */
export async function updateShotPrompt(
  projectId: string,
  shotId: string,
  frame: 'first' | 'last' | 'video',
  prompt: string,
  directives?: Record<string, any>
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/shots/update-prompt`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shotId, frame, prompt, ...(directives || {}) }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '保存镜头提示词失败');
  }
}

/** 切换前序镜头视听连续性模式：auto（智能决策）| linked（强制连贯）| detached（独立机位） */
export async function updateShotContinuity(
  projectId: string,
  shotId: string,
  continuityMode: 'auto' | 'linked' | 'detached',
  firstFramePrompt?: string
): Promise<any> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/shots/update-continuity`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shotId, continuityMode, firstFramePrompt }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '更新镜头连续性模式失败');
  }
  return data;
}

/** 基于当前帧图片做 AI 定向微调，产出的一帧自动追加为新版本 */
export async function refineShotImage(
  projectId: string,
  shotId: string,
  frame: 'first' | 'last',
  instruction: string,
  baseImageUrl?: string
): Promise<{ success: boolean; directedPrompt: string; baseImageUrl: string; task?: TaskRecord }> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/shots/refine`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shotId, frame, instruction, baseImageUrl }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '镜头定向微调失败');
  }
  return data;
}

/** 更新指定分幕的视听摄制台本 (Shooting Script) */
export async function updateShootingScript(
  projectId: string,
  clipId: string,
  shootingScript: any
): Promise<{ success: boolean; shootingScript: any; shots: any[] }> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/shooting-script/update`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clipId, shootingScript }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '保存视听摄制台本失败');
  }
  return data;
}
