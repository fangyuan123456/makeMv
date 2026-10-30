import { WorkflowSession, WorkflowStage, SessionStatus, StopPoint } from '../../types/workflow.js';
import { BaseAgent, AgentResult } from '../../agents/base/index.js';

export type PipelineStep =
  | { type: 'stage'; stage: WorkflowStage }
  | { type: 'parallel'; stages: WorkflowStage[] }
  | { type: 'sequence'; stages: WorkflowStage[] };

export const stage = (s: WorkflowStage): PipelineStep => ({ type: 'stage', stage: s });
export const parallel = (stages: WorkflowStage[]): PipelineStep => ({ type: 'parallel', stages });
export const sequence = (stages: WorkflowStage[]): PipelineStep => ({ type: 'sequence', stages });

export interface PipelineExecutionOptions {
  userFeedback?: string;
  stageOverride?: WorkflowStage;
}

export type TargetResolutionAction =
  | 'EXECUTE_SINGLE'
  | 'EXECUTE_PARALLEL'
  | 'EXECUTE_SEQUENCE'
  | 'COMPLETE'
  | 'IDLE';

export interface TargetResolution {
  action: TargetResolutionAction;
  stage?: WorkflowStage;
  stages?: WorkflowStage[];
}

export interface PipelineContext {
  session: WorkflowSession;
  projectDir: string;
  targetStage: WorkflowStage;
  userFeedback?: string;
}
