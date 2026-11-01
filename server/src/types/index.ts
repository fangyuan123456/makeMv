/**
 * types/index.ts
 * 现代 Agentic 互动影游全链路业务模型与强类型契约 (Domain Types SSOT)
 *
 * 遵循法典：
 * 1. 契约与磁盘真实代码 100% 绝对 1:1 严密对齐；
 * 2. 现代去 Agent 化架构：AI 导演对话中枢 + 7 大工序标准技能包 + 独立审查官；
 * 3. 严格全链路单一事实来源 (SSOT)。
 */

export enum WorkflowStage {
  INIT = 'init',
  NARRATIVE_DESIGN = 'narrative_design', // 1. 叙事架构 (Story Bible)
  CHARACTER_DESIGN = 'character_design', // 2. 角色定妆 (Character Portrait)
  SCENE_SCRIPT = 'scene_script', // 3. 分场剧本 (Scene Script)
  STORYBOARD = 'storyboard', // 4. 视听分镜 (Storyboard)
  KEYFRAME_REFERENCE = 'keyframe_reference', // 5. 关键帧图 (Keyframe Reference)
  VIDEO_PRODUCTION = 'video_production', // 6. 视频生成 (Video Production)
  FMV_PACKAGING = 'fmv_packaging', // 7. 影游装配 (FMV Packaging)
  COMPLETED = 'completed',
}

/** 🌟 严格对应当前系统中真实已落地的 7 大工序标准执行序列 (SSOT) */
export const STAGE_SEQUENCE: WorkflowStage[] = [
  WorkflowStage.NARRATIVE_DESIGN,
  WorkflowStage.CHARACTER_DESIGN,
  WorkflowStage.SCENE_SCRIPT,
  WorkflowStage.STORYBOARD,
  WorkflowStage.KEYFRAME_REFERENCE,
  WorkflowStage.VIDEO_PRODUCTION,
  WorkflowStage.FMV_PACKAGING,
];

/**
 * 智能体基础输入契约规范 (BaseAgentInput SSOT)
 */
export interface BaseAgentInput {
  projectId: string;
  userFeedback?: string;
  abortSignal?: AbortSignal;
  options?: Record<string, unknown>;
}

export enum SessionStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  WAITING_FOR_INTERVENTION = 'waiting_for_intervention',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface StopPoint {
  id: string;
  stage: WorkflowStage;
  title: string;
  description: string;
  artifactSummary: any;
  requiresConfirmation: boolean;
  createdAt: string;
}

export interface SessionMeta {
  idea: string;
  style: string;
  videoRatio: '16:9' | '9:16' | '1:1';
  videoResolution: '480P' | '720P' | '1080P';
  [key: string]: any;
}

export interface SessionChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  senderName?: string;
  content: string;
  thought?: string;
  thinkingDurationSec?: number;
  timestamp: string;
  stage?: WorkflowStage | string;
  stopPoint?: StopPoint;
}

/**
 * 核心工作流项目状态模型 (SSOT)
 * 全链路统一定位为 projectId
 */
export interface WorkflowSession {
  projectId: string;
  title: string;
  meta: SessionMeta;
  currentStage: WorkflowStage;
  status: SessionStatus;
  currentStopPoint?: StopPoint;
  stageArtifacts: Record<string, any>;
  messages?: SessionChatMessage[];
  history: Array<{
    timestamp: string;
    stage: WorkflowStage;
    action: string;
    details?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface JobContext {
  projectId: string;
  title: string;
  idea: string;
  style: string;
  videoRatio?: string;
  videoResolution?: string;
  episodes?: number;
}
