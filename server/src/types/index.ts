/**
 * types/index.ts
 * 现代 Agentic 互动影游全链路业务模型与强类型契约 (Domain Types SSOT)
 *
 * 核心机制与架构解耦原则（法典 0.3/0.4）：
 * 1. 契约与磁盘真实代码 1:1 严密对齐；
 * 2. 底层聚合根与业务类型完全解耦上层具体技能包 (skills/*) 与审查官 (agents/reviewer)，彻底切断向上逆向引用；
 * 3. 彻底杜绝未迁移技能模块引发的 TS2307 编译阻断；
 * 4. StageArtifactMap 显式定义各工序阶段标准键位契约，默认收敛为通用强类型 Record<string, any>；
 * 5. 消费端通过 IProjectStateStore.getArtifact<T>(projectId, stage) 声明局部强类型，并支持泛型与声明合并扩展；
 * 6. 严格全链路单一事实来源 (SSOT)。
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
 * 基础工序产物通用契约 (Base Stage Artifact)
 */
export interface BaseArtifact {
  [key: string]: unknown;
}

/**
 * 权威工序阶段产物映射表通用契约 (StageArtifactMap SSOT)
 *
 * 解耦设计说明：
 * 1. 彻底移除对 ../skills/* 与 ../agents/reviewer/* 的静态 import，消除层级倒置与循环依赖；
 * 2. 显式声明 7 大标准工序键名，为上层消费提供标准索引与类型感知；
 * 3. 消费端通过 IProjectStateStore.getArtifact<T>(projectId, stage) 声明局部强类型，实现无侵入安全消费；
 * 4. 允许通过 TypeScript 模块扩展 (declare module) 或泛型参数扩展强类型。
 */
export interface StageArtifactMap {
  narrative_design?: Record<string, any>;
  character_design?: Record<string, any>;
  scene_script?: Record<string, any>;
  storyboard?: Record<string, any>;
  keyframe_reference?: Record<string, any>;
  video_production?: Record<string, any>;
  fmv_packaging?: Record<string, any>;
  critic_review?: Record<string, any>;
  [key: `critic_review_${string}`]: Record<string, any> | undefined;
  [stage: string]: any;
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
export interface ProjectEntity<TArtifacts extends StageArtifactMap = StageArtifactMap> {
  projectId: string;
  title: string;
  meta: SessionMeta;
  currentStage: WorkflowStage;
  status: SessionStatus;
  currentStopPoint?: StopPoint;
  stageArtifacts: Partial<TArtifacts> & Record<string, any>;
  history: Array<{
    timestamp: string;
    stage: WorkflowStage;
    action: string;
    details?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowSession<TArtifacts extends StageArtifactMap = StageArtifactMap> = ProjectEntity<TArtifacts>;

export interface JobContext {
  projectId: string;
  title: string;
  idea: string;
  style: string;
  videoRatio?: string;
  videoResolution?: string;
  episodes?: number;
}

export * from './proposal.js';

