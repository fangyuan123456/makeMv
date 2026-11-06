/**
 * agents/director/generator/steps/keyframe-reference/keyframe-reference.step.ts
 * 影视工序第 5 阶段：关键帧参考图 (Keyframe Reference Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext, shouldSkipUnchangedStep } from '../common.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../types/index.js';
import { keyframeReferenceSubWorkflow } from './keyframe-reference.workflow.js';
import type { KeyframeReferenceArtifact } from './schema.js';

export async function executeKeyframeReference(context: WorkflowContext): Promise<WorkflowContext> {
  const { projectId } = context;
  const store = ProjectStore.getInstance();
  const currentKeyframes = store.getArtifact<KeyframeReferenceArtifact>(projectId, WorkflowStage.KEYFRAME_REFERENCE);

  // 1. 检查是否跳过
  const skipCheck = shouldSkipUnchangedStep(projectId, WorkflowStage.KEYFRAME_REFERENCE, 'keyframeReferenceStep', context);
  if (skipCheck.shouldSkip) {
    return {
      ...context,
      toolResult: skipCheck.existingArtifact || currentKeyframes,
      lastSummary: '关键帧参考图：已跳过未变更工序并复用既有资产。',
    };
  }

  // 2. 调用关键帧子工作流
  const run = await (keyframeReferenceSubWorkflow as any).createRun();
  const runResult = await run.start({
    inputData: context,
  });

  const finalContext = (runResult?.results as any)?.output || (runResult as any)?.output || runResult;
  return finalContext || context;
}

export const keyframeReferenceStep = createStep({
  id: 'keyframe-reference-step',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    return await executeKeyframeReference(inputData);
  },
});
