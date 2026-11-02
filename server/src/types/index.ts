/**
 * types/index.ts
 * 现代 Agentic 互动影游全链路业务模型与强类型契约 (Domain Types SSOT)
 *
 * 核心机制：
 * 1. 契约与磁盘真实代码 1:1 严密对齐；
 * 2. 现代微内核架构：AI 导演对话中枢 + 7 大工序标准技能包 + 独立审查官；
 * 3. 严格全链路单一事实来源 (SSOT)。
 */

import type { StoryBibleArtifact } from '../skills/story-bible/index.js';
import type { CharacterPortraitArtifact } from '../skills/character-portrait/index.js';
import type { SceneScriptArtifact } from '../skills/scene-script/index.js';
import type { StoryboardArtifact } from '../skills/storyboard/index.js';
import type { KeyframeReferenceArtifact } from '../skills/keyframe-reference/index.js';
import type { VideoProductionArtifact } from '../skills/video-production/index.js';
import type { FmvPackagingArtifact } from '../skills/fmv-packaging/index.js';
import type { ReviewReport } from '../agents/reviewer/index.js';

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

/** 严格对应当前系统中真实已落地的 7 大工序标准执行序列 */
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
 * 权威工序阶段产物映射表契约 (StageArtifactMap SSOT)
 * 彻底消除 stageArtifacts: Record<string, any>，实现强类型约束
 */
export interface StageArtifactMap {
  narrative_design: StoryBibleArtifact;
  character_design: CharacterPortraitArtifact;
  scene_script: SceneScriptArtifact;
  storyboard: StoryboardArtifact;
  keyframe_reference: KeyframeReferenceArtifact;
  video_production: VideoProductionArtifact;
  fmv_packaging: FmvPackagingArtifact;
  critic_review: ReviewReport;
  [key: `critic_review_${string}`]: ReviewReport | undefined;
}

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
  artifactSummary: Record<string, unknown> | string;
  requiresConfirmation: boolean;
  createdAt: string;
}

export interface SessionMeta {
  idea: string;
  style: string;
  videoRatio: '16:9' | '9:16' | '1:1';
  videoResolution: '480P' | '720P' | '1080P';
  userConstraints?: string[];
  [key: string]: unknown;
}

/**
 * 核心工作流项目聚合根领域模型 (ProjectEntity SSOT)
 */
export interface ProjectEntity {
  projectId: string;
  title: string;
  meta: SessionMeta;
  currentStage: WorkflowStage;
  status: SessionStatus;
  currentStopPoint?: StopPoint;
  stageArtifacts: Partial<StageArtifactMap> & Record<string, any>;
  history: Array<{
    timestamp: string;
    stage: WorkflowStage;
    action: string;
    details?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowSession = ProjectEntity;

export interface JobContext {
  projectId: string;
  title: string;
  idea: string;
  style: string;
  videoRatio?: string;
  videoResolution?: string;
  episodes?: number;
}
