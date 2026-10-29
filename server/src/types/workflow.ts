import { z } from 'zod';

export enum WorkflowStage {
  INIT = 'init',
  SCRIPT_GENERATION = 'script_generation', // 剧本大纲
  CHARACTER_DESIGN = 'character_design',   // 角色
  EPISODE_SCRIPT = 'episode_script',       // 分集
  STORYBOARD = 'storyboard',               // 分镜
  REFERENCE_GENERATION = 'reference_generation', // 参考图
  VIDEO_POST = 'video_post',               // 视频后期
  COMPLETED = 'completed',
}

export const STAGE_SEQUENCE: WorkflowStage[] = [
  WorkflowStage.SCRIPT_GENERATION,
  WorkflowStage.CHARACTER_DESIGN,
  WorkflowStage.EPISODE_SCRIPT,
  WorkflowStage.STORYBOARD,
  WorkflowStage.REFERENCE_GENERATION,
  WorkflowStage.VIDEO_POST,
];

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
  episodes: number;
  isInteractiveFMV?: boolean;
  [key: string]: any;
}

export interface WorkflowSession {
  id: string;
  title: string;
  meta: SessionMeta;
  currentStage: WorkflowStage;
  status: SessionStatus;
  currentStopPoint?: StopPoint;
  stageArtifacts: Record<string, any>;
  history: Array<{
    timestamp: string;
    stage: WorkflowStage;
    action: string;
    details?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}
