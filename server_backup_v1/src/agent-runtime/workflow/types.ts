/**
 * agent-runtime/workflow/types.ts
 * 智能体工序编排与蓝图执行机强类型契约 (SSOT)
 */

import type { WorkflowStage } from '../../types/index.js';

export type StageBlueprint =
  | {
      type: 'STAGE';
      stage: WorkflowStage;
      label: string;
    }
  | {
      type: 'PARALLEL';
      label: string;
      stages: Array<{ stage: WorkflowStage; label?: string }>;
    }
  | {
      type: 'SEQUENCE';
      label: string;
      stages: Array<{ stage: WorkflowStage; label?: string }>;
    };

export type StagePipelineFactory = (projectId: string) => {
  execute(input: any): Promise<{ success: boolean; data?: any; summary?: string }>;
};

export interface StageHealer {
  diagnose(params: {
    stage: string;
    model: string;
    error: string;
    originalPrompt: string;
    context?: string;
    validationError?: string;
    projectId?: string;
  }): Promise<{
    should_retry: boolean;
    rewrittenPrompt?: string;
    reason_type?: string;
  }>;
}

export interface StageExecutorConfig {
  pipelineRegistry: Record<string, StagePipelineFactory>;
  healer?: StageHealer;
}
