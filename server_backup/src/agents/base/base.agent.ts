import { WorkflowSession, WorkflowStage } from '../../types/workflow.js';
import type { AgentAuditRecorder } from '../../audit/index.js';

export interface AgentContext {
  session: WorkflowSession;
  projectDir: string;
  userFeedback?: string;
  audit?: AgentAuditRecorder;
}

export interface AgentResult<T = any> {
  stage: WorkflowStage;
  artifact: T;
  requiresIntervention: boolean;
  stopPointTitle: string;
  stopPointDescription: string;
}

export abstract class BaseAgent<T = any> {
  abstract readonly stage: WorkflowStage;

  abstract execute(context: AgentContext): Promise<AgentResult<T>>;
}
