import { WorkflowSession, WorkflowStage, SessionStatus } from '../../types/workflow.js';
import { PipelineStep, TargetResolution } from './pipeline.types.js';

export class PipelineNavigator {
  constructor(private steps: PipelineStep[]) {}

  /**
   * 查找包含给定工作流阶段的里程碑步骤索引。
   */
  findStepIndexByStage(stage: WorkflowStage): number {
    return this.steps.findIndex((step) => {
      if (step.type === 'stage') return step.stage === stage;
      return step.stages.includes(stage);
    });
  }

  getStep(index: number): PipelineStep | null {
    if (index < 0 || index >= this.steps.length) return null;
    return this.steps[index];
  }

  isLastStep(index: number): boolean {
    return index >= this.steps.length - 1;
  }

  private stepToResolution(step: PipelineStep): TargetResolution {
    switch (step.type) {
      case 'stage':
        return { action: 'EXECUTE_SINGLE', stage: step.stage };
      case 'parallel':
        return { action: 'EXECUTE_PARALLEL', stages: step.stages };
      case 'sequence':
        return { action: 'EXECUTE_SEQUENCE', stages: step.stages };
    }
  }

  /**
   * 根据当前会话状态解析下一步骤动作与目标阶段。
   */
  resolveTarget(
    session: WorkflowSession,
    options?: { stageOverride?: WorkflowStage; feedback?: string }
  ): TargetResolution {
    // 1. Explicit single-stage override takes highest priority
    if (options?.stageOverride && Object.values(WorkflowStage).includes(options.stageOverride)) {
      return { action: 'EXECUTE_SINGLE', stage: options.stageOverride };
    }

    // 2. Terminal state check
    if (session.status === SessionStatus.COMPLETED || session.currentStage === WorkflowStage.COMPLETED) {
      return { action: 'IDLE' };
    }

    // 3. Initial project start -> return first step
    if (session.currentStage === WorkflowStage.INIT) {
      const first = this.steps[0];
      if (!first) return { action: 'COMPLETE' };
      return this.stepToResolution(first);
    }

    // 4. Continued from an intervention point without revision feedback -> advance to next step
    if (session.status === SessionStatus.WAITING_FOR_INTERVENTION && !options?.feedback) {
      const currentStepIdx = this.findStepIndexByStage(session.currentStage);
      if (currentStepIdx < 0 || this.isLastStep(currentStepIdx)) {
        return { action: 'COMPLETE' };
      }

      const nextStep = this.getStep(currentStepIdx + 1);
      if (!nextStep) return { action: 'COMPLETE' };

      return this.stepToResolution(nextStep);
    }

    // 5. Normal or revised re-execution of current step
    const currentStepIdx = this.findStepIndexByStage(session.currentStage);
    const currentStep = this.getStep(currentStepIdx);

    if (currentStep) {
      return this.stepToResolution(currentStep);
    }

    return { action: 'EXECUTE_SINGLE', stage: session.currentStage };
  }
}
