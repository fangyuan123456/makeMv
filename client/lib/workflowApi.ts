/**
 * 工作流 API 客户端
 */

/**
 * Streaming endpoints must bypass the Next.js rewrite proxy because it buffers
 * the entire upstream response before forwarding, which breaks SSE real-time delivery.
 * Non-streaming endpoints can still go through the proxy (relative URL).
 */
export const DIRECT_API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
const STREAM_API_BASE = DIRECT_API_BASE;

export interface ProjectStatus {
  projectId: string;
  currentStage?: string;
  status: any;
  error?: string | null;
  artifacts?: Record<string, any>;
  stage_progress?: Record<string, any>;
  session?: any;
  project?: any;
}

export interface StreamEvent {
  type: 'progress' | 'heartbeat' | 'stage_complete' | 'error' | 'content';
  message?: string;
  phase?: string;
  step_desc?: string;
  percent?: number;
  stage?: string;
  status?: string;
  requires_intervention?: boolean;
  payload_summary?: any;
  content?: string;
  time?: number;
  data?: any;
}

export interface PipelineTask {
  task_id: string;
  pipeline: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | string;
  progress?: number;
  message?: string;
  input?: Record<string, any>;
  output?: Record<string, any>;
  artifacts?: Array<{ kind: string; name?: string; path: string; exists?: boolean; created_at?: string }>;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
  output_dir?: string;
}

export interface SandboxTask {
  id: string;
  tool: string;
  model: string;
  input?: Record<string, any>;
  status: string;
  progress?: number;
  created_at?: string;
}

export interface PipelineStartResponse {
  task_id: string;
  pipeline: string;
  status: string;
  metadata_url: string;
  output_dir: string;
}

export interface PipelineTaskEvent {
  type: 'snapshot' | 'progress' | 'artifact' | 'completed' | 'failed';
  task_id: string;
  status?: string;
  progress?: number;
  artifact?: { kind: string; name?: string; path: string; exists?: boolean; created_at?: string };
}

export interface ApiModelOption {
  id: string;
  label: string;
  provider: string;
  family?: string;
  media_type?: 'image' | 'video';
  model_type?: 'llm' | 'vlm' | 't2i' | 'i2i' | 'video';
  type?: string[];
  ability_type?: string;
  ability_types?: string[];
  adapter_ability_types?: string[];
  input_modalities?: string[];
  adapter_input_modalities?: string[];
  api_contract_verified?: boolean;
  capabilities?: Record<string, any>;
}

export interface StandardTemplateOption {
  id: string;
  name: string;
  label: string;
  size: string;
  ratio: '9:16' | '1:1' | '16:9' | string;
  width: number;
  height: number;
  media_width: number;
  media_height: number;
  media_ratio: string;
  media_resolution: string;
  supports_video?: boolean;
  fields: Array<{ key: string; type: string; default: string }>;
  preview_url: string;
}

async function parseJsonResponse<T>(resp: Response, fallback?: T): Promise<T> {
  const text = await resp.text().catch(() => '');
  if (!text) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Empty response from server (HTTP ${resp.status})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    if (fallback !== undefined) return fallback;
    throw new Error(`Server returned non-JSON response (HTTP ${resp.status}): ${text.slice(0, 120)}`);
  }
}

export async function fetchProjects(): Promise<any[]> {
  try {
    const resp = await fetch('/api/projects');
    if (!resp.ok) return [];
    const data = await parseJsonResponse<{ projects?: any[] }>(resp, { projects: [] });
    return data.projects || [];
  } catch {
    return [];
  }
}

async function postPipelineTask(path: string, params: Record<string, any>): Promise<PipelineStartResponse> {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!resp.ok) {
    const err = await parseJsonResponse<any>(resp, { detail: '启动任务失败' });
    throw new Error(err.detail || '启动任务失败');
  }
  return parseJsonResponse<PipelineStartResponse>(resp);
}

export async function startStandardPipeline(params: Record<string, any>): Promise<PipelineStartResponse> {
  return postPipelineTask('/api/pipelines/standard/tasks', params);
}

export async function startActionTransferPipeline(params: Record<string, any>): Promise<PipelineStartResponse> {
  return postPipelineTask('/api/pipelines/action_transfer/tasks', params);
}

export async function startDigitalHumanPipeline(params: Record<string, any>): Promise<PipelineStartResponse> {
  return postPipelineTask('/api/pipelines/digital_human/tasks', params);
}

export async function fetchPipelineTasks(limit = 100): Promise<PipelineTask[]> {
  const resp = await fetch(`/api/tasks?limit=${limit}`);
  if (!resp.ok) return [];
  const data = await parseJsonResponse<{ tasks?: PipelineTask[] }>(resp, { tasks: [] });
  return data.tasks || [];
}

export async function fetchPipelineTask(taskId: string): Promise<PipelineTask> {
  const resp = await fetch(`/api/tasks/${taskId}`);
  if (!resp.ok) throw new Error('获取任务状态失败');
  return parseJsonResponse<PipelineTask>(resp);
}

export async function fetchSandboxTasks(): Promise<SandboxTask[]> {
  const resp = await fetch('/api/sandbox/tasks');
  if (!resp.ok) return [];
  const data = await parseJsonResponse<{ tasks?: SandboxTask[] }>(resp, { tasks: [] });
  return data.tasks || [];
}

export async function clearTempCache(): Promise<{ status: string; deleted: number; freed_bytes?: number; freed_mb?: number; errors?: Array<{ path: string; error: string }> }> {
  const resp = await fetch('/api/cache/temp', { method: 'DELETE' });
  if (!resp.ok) {
    const err = await parseJsonResponse<any>(resp, { detail: '清空缓存失败' });
    throw new Error(err.detail || '清空缓存失败');
  }
  return parseJsonResponse(resp);
}

export async function deletePipelineTask(taskId: string): Promise<void> {
  const resp = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error('删除任务失败');
}

export async function fetchApiModels(params: {
  mediaType?: 'image' | 'video';
  modelType?: 'llm' | 'vlm' | 't2i' | 'i2i' | 'video';
  ability?: string;
  verifiedOnly?: boolean;
} = {}): Promise<ApiModelOption[]> {
  const search = new URLSearchParams();
  if (params.mediaType) search.set('media_type', params.mediaType);
  if (params.modelType) search.set('model_type', params.modelType);
  if (params.ability) search.set('ability', params.ability);
  if (params.verifiedOnly) search.set('verified_only', 'true');
  const resp = await fetch(`/api/models${search.toString() ? `?${search.toString()}` : ''}`);
  if (!resp.ok) return [];
  const data = await parseJsonResponse<{ models?: ApiModelOption[] }>(resp, { models: [] });
  return data.models || [];
}

export async function fetchStandardTemplates(): Promise<StandardTemplateOption[]> {
  const resp = await fetch('/api/pipelines/standard/templates');
  if (!resp.ok) return [];
  const data = await parseJsonResponse<{ templates?: StandardTemplateOption[] }>(resp, { templates: [] });
  return data.templates || [];
}

export async function uploadMedia(file: File): Promise<{ filename: string; file_path: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const resp = await fetch('/api/upload_media', {
    method: 'POST',
    body: formData,
  });
  if (!resp.ok) {
    const err = await parseJsonResponse<any>(resp, { detail: '上传失败' });
    throw new Error(err.detail || '上传失败');
  }
  return parseJsonResponse(resp);
}

export async function uploadArtifactImage(
  sessionId: string,
  stage: string,
  itemType: string,
  itemId: string,
  file: File,
): Promise<{ status: string; path: string; artifact: any; status_map: Record<string, string> }> {
  const formData = new FormData();
  formData.append('item_type', itemType);
  formData.append('item_id', itemId);
  formData.append('file', file);
  const resp = await fetch(`/api/project/${sessionId}/artifact/${stage}/upload_image`, {
    method: 'POST',
    body: formData,
  });
  if (!resp.ok) {
    const err = await parseJsonResponse<any>(resp, { detail: '上传图片失败' });
    throw new Error(err.detail || '上传图片失败');
  }
  return parseJsonResponse(resp);
}

export function subscribePipelineTask(
  taskId: string,
  onEvent: (event: PipelineTaskEvent) => void,
  onError?: () => void,
): () => void {
  const source = new EventSource(`${STREAM_API_BASE}/api/tasks/${taskId}/events`);
  source.onmessage = event => {
    try {
      onEvent(JSON.parse(event.data));
    } catch {
      // Ignore malformed stream events.
    }
  };
  source.onerror = () => {
    onError?.();
    source.close();
  };
  return () => source.close();
}

export async function startProject(params: {
  idea: string;
  file_path?: string;
  style?: string;
  videoRatio?: string;
  videoResolution?: string;
  video_ratio?: string;
  video_resolution?: string;
  llm_model?: string;
  vlm_model?: string;
  image_t2i_model?: string;
  image_it2i_model?: string;
  video_model?: string;
  video_first_frame_model?: string;
  video_start_end_model?: string;
  video_reference_model?: string;
  video_generation_mode?: string;
  scene_number?: number;
  enable_concurrency?: boolean;
  web_search?: boolean;
  expand_idea?: boolean;
}): Promise<{ projectId: string; status: string; params: any }> {
  const normalizedParams = {
    ...params,
    videoRatio: params.videoRatio || params.video_ratio || '16:9',
    videoResolution: params.videoResolution || params.video_resolution || '720P',
  };
  const resp = await fetch('/api/project/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizedParams),
  });
  if (!resp.ok) {
    const err = await parseJsonResponse<any>(resp, { detail: '项目创建失败' });
    throw new Error(err.detail || '项目创建失败');
  }
  const data = await parseJsonResponse<any>(resp);
  return { ...data, projectId: data.projectId };
}

export async function getProjectStatus(projectId: string): Promise<ProjectStatus> {
  const resp = await fetch(`/api/project/${projectId}/status`);
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Failed to get project status (${resp.status}): ${errText || resp.statusText}`);
  }
  return parseJsonResponse<ProjectStatus>(resp);
}

export async function getArtifact(sessionId: string, stage: string): Promise<any> {
  const resp = await fetch(`/api/project/${sessionId}/artifact/${stage}`);
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Artifact for stage '${stage}' not found (${resp.status}): ${errText || resp.statusText}`);
  }
  return parseJsonResponse<any>(resp);
}

export async function executeStage(
  sessionId: string,
  stage: string,
  inputData: Record<string, any> = {},
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${STREAM_API_BASE}/api/project/${sessionId}/execute/${stage}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inputData),
    signal,
  });
}

export async function intervene(
  sessionId: string,
  stageOrFeedback: string,
  modifications?: Record<string, any>,
): Promise<Response> {
  const payload = modifications !== undefined
    ? { stage: stageOrFeedback, modifications, feedback: modifications.feedback || modifications }
    : { feedback: stageOrFeedback, modifications: { feedback: stageOrFeedback } };

  return fetch(`${STREAM_API_BASE}/api/project/${sessionId}/continue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function stopProject(sessionId: string): Promise<{ status: string }> {
  const resp = await fetch(`/api/project/${sessionId}/stop`, {
    method: 'POST',
  });
  return parseJsonResponse<{ status: string }>(resp, { status: 'stopped' });
}

export async function deleteSession(
  sessionId: string,
): Promise<{ status: string }> {
  const resp = await fetch(`/api/project/${sessionId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok) {
    const err = await parseJsonResponse<any>(resp, { detail: '删除失败' });
    throw new Error(err.detail || '删除失败');
  }
  return parseJsonResponse<{ status: string }>(resp, { status: 'deleted' });
}

export async function saveSelections(
  sessionId: string,
  stage: string,
  selections: Record<string, any>,
): Promise<{ status: string }> {
  try {
    const payload = selections.selections ? selections : { selections };
    const resp = await fetch(`/api/project/${sessionId}/artifact/${stage}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.warn(`[saveSelections] Server returned HTTP ${resp.status}`);
      return { status: 'failed' };
    }
    return parseJsonResponse<{ status: string }>(resp, { status: 'saved' });
  } catch (err) {
    console.warn('[saveSelections] Network or parse error:', err);
    return { status: 'failed' };
  }
}

export async function continueWorkflow(sessionId: string): Promise<{ status: string; next_stage?: string }> {
  const resp = await fetch(`/api/project/${sessionId}/continue`, {
    method: 'POST',
  });
  return parseJsonResponse<{ status: string; next_stage?: string }>(resp, { status: 'continued' });
}

export async function getStageAuditTrace(sessionId: string, stage: string): Promise<any> {
  try {
    const resp = await fetch(`/api/project/${sessionId}/audit/${stage}`);
    if (!resp.ok) return null;
    return parseJsonResponse(resp);
  } catch {
    return null;
  }
}

export async function* parseStreamEvents(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const raw: any = JSON.parse(line);
        if (raw.type && raw.type !== 'heartbeat') {
          yield raw as StreamEvent;
        } else if (!raw.type && (raw.success || raw.session)) {
          yield {
            type: 'stage_complete',
            stage: raw.session?.currentStage,
            status: 'completed',
            data: raw.session?.stageArtifacts,
          };
        }
      } catch { /* skip malformed */ }
    }
  }
  if (buffer.trim()) {
    try {
      const raw: any = JSON.parse(buffer);
      if (raw.type && raw.type !== 'heartbeat') {
        yield raw as StreamEvent;
      } else if (!raw.type && (raw.success || raw.session)) {
        yield {
          type: 'stage_complete',
          stage: raw.session?.currentStage,
          status: 'completed',
          data: raw.session?.stageArtifacts,
        };
      }
    } catch { /* skip malformed */ }
  }
}
