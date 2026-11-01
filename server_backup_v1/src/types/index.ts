/**
 * types/index.ts
 * 互动影游与多智能体导演全链路业务模型与强类型契约 (Domain Types SSOT)
 *
 * 遵循法典：契约与磁盘真实 Agent 100% 绝对 1:1 严密对齐，严禁任何超前与脱节定义。
 * 当前真实就绪阶段（全链路 7 大阶段 100% 完整闭环）：
 * 1. 叙事设计 (narrative_design ➔ NARRATIVE_DESIGNER)
 * 2. 角色设计 (character_design ➔ CHARACTER_DESIGNER)
 * 3. 场景剧本 (scene_script ➔ SCENE_SCRIPT)
 * 4. 视听分镜 (storyboard ➔ STORYBOARD)
 * 5. 关键帧参考图 (keyframe_reference ➔ KEYFRAME_REFERENCE)
 * 6. 动态视频生产 (video_production ➔ VIDEO_PRODUCTION)
 * 7. 影游装配发布 (fmv_packaging ➔ FMV_PACKAGER)
 */

export enum WorkflowStage {
  INIT = 'init',
  NARRATIVE_DESIGN = 'narrative_design',
  CHARACTER_DESIGN = 'character_design',
  SCENE_SCRIPT = 'scene_script',
  STORYBOARD = 'storyboard',
  KEYFRAME_REFERENCE = 'keyframe_reference',
  VIDEO_PRODUCTION = 'video_production',
  FMV_PACKAGING = 'fmv_packaging',
  COMPLETED = 'completed',
}

/** 🌟 严格对应当前系统中真实已落地的阶段执行序列 (SSOT) */
export const STAGE_SEQUENCE: WorkflowStage[] = [
  WorkflowStage.NARRATIVE_DESIGN,
  WorkflowStage.CHARACTER_DESIGN,
  WorkflowStage.SCENE_SCRIPT,
  WorkflowStage.STORYBOARD,
  WorkflowStage.KEYFRAME_REFERENCE,
  WorkflowStage.VIDEO_PRODUCTION,
  WorkflowStage.FMV_PACKAGING,
];

/** 🌟 严格对应当前系统中真实已落地的 Agent 角色 (SSOT) */
export const FILM_AGENT_ROLES = {
  DIRECTOR: 'DIRECTOR',
  NARRATIVE_DESIGNER: 'NARRATIVE_DESIGNER',
  CHARACTER_DESIGNER: 'CHARACTER_DESIGNER',
  SCENE_SCRIPT: 'SCENE_SCRIPT',
  STORYBOARD: 'STORYBOARD',
  KEYFRAME_REFERENCE: 'KEYFRAME_REFERENCE',
  VIDEO_PRODUCTION: 'VIDEO_PRODUCTION',
  FMV_PACKAGER: 'FMV_PACKAGER',
  DOCTOR: 'DOCTOR',
} as const;

export type FilmAgentRole = (typeof FILM_AGENT_ROLES)[keyof typeof FILM_AGENT_ROLES];

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
