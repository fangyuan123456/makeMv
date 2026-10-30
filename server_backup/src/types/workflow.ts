import { z } from 'zod';

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

export const STAGE_SEQUENCE: WorkflowStage[] = [
  WorkflowStage.NARRATIVE_DESIGN,
  WorkflowStage.CHARACTER_DESIGN,
  WorkflowStage.SCENE_SCRIPT,
  WorkflowStage.STORYBOARD,
  WorkflowStage.KEYFRAME_REFERENCE,
  WorkflowStage.VIDEO_PRODUCTION,
  WorkflowStage.FMV_PACKAGING,
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
  isInteractiveFMV?: boolean;
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

export interface WorkflowSession {
  id: string;
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
