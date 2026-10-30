import { WorkflowStage } from '../types/workflow.js';

export interface PromptPayload {
  systemPrompt?: string;
  userPrompt: string;
  templateName?: string;
  parameters?: Record<string, any>;
}

export interface AiCallRecord {
  callId: string;
  timestamp: string;
  callType: 'llm_chat' | 'llm_json' | 'image_t2i' | 'image_i2i' | 'video_t2v' | 'video_i2v';
  model: string;
  prompt: PromptPayload | string;
  rawResponse?: string | any;
  durationMs: number;
  status: 'success' | 'fallback' | 'error';
  error?: string;
  meta?: Record<string, any>;
}

export interface StageTurnArchive {
  archiveId: string;
  turnIndex: number;
  sessionId: string;
  stage: WorkflowStage;
  agentName: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  sessionMeta?: Record<string, any>;
  upstreamArtifacts?: Record<string, any>;
  userFeedback?: string;
  status: 'success' | 'failed';
  stopPointTitle?: string;
  stopPointDescription?: string;
  error?: string;
  aiCalls: AiCallRecord[];
  finalArtifact?: any;
}

export interface SessionAuditSummary {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  totalTurns: number;
  stagesExecuted: WorkflowStage[];
  records: Array<{
    archiveId: string;
    stage: WorkflowStage;
    agentName: string;
    stageFolder: string;
    timestamp: string;
    durationMs: number;
    status: 'success' | 'failed';
    aiCallsCount: number;
  }>;
}

export function getStageFolderPrefix(stage: WorkflowStage): string {
  switch (stage) {
    case WorkflowStage.NARRATIVE_DESIGN:
      return '01_narrative_designer';
    case WorkflowStage.CHARACTER_DESIGN:
      return '02_character_designer';
    case WorkflowStage.SCENE_SCRIPT:
      return '02_scene_script';
    case WorkflowStage.STORYBOARD:
      return '03_storyboard';
    case WorkflowStage.KEYFRAME_REFERENCE:
      return '03_keyframe_reference';
    case WorkflowStage.VIDEO_PRODUCTION:
      return '04_video_production';
    case WorkflowStage.FMV_PACKAGING:
      return '05_fmv_packager';
    default:
      return stage;
  }
}
