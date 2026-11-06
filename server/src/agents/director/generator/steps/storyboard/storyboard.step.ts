/**
 * agents/director/generator/steps/storyboard/storyboard.step.ts
 * 影视工序第 4 阶段：视听分镜头 (Storyboard Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext, shouldSkipUnchangedStep } from '../common.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../types/index.js';
import { storyboardSubWorkflow } from './storyboard.workflow.js';
import type { StoryboardArtifact } from './schema.js';

export async function executeStoryboard(context: WorkflowContext): Promise<WorkflowContext> {
  const { projectId } = context;
  const store = ProjectStore.getInstance();
  const currentStoryboard = store.getArtifact<StoryboardArtifact>(projectId, WorkflowStage.STORYBOARD);

  // 1. 检查是否跳过
  const skipCheck = shouldSkipUnchangedStep(projectId, WorkflowStage.STORYBOARD, 'storyboardStep', context);
  if (skipCheck.shouldSkip) {
    return {
      ...context,
      toolResult: skipCheck.existingArtifact || currentStoryboard,
      lastSummary: '视听分镜：已跳过未变更工序并复用既有资产。',
    };
  }

  // 2. 调用视听分镜子工作流
  const run = await (storyboardSubWorkflow as any).createRun();
  const runResult = await run.start({
    inputData: context,
  });

  const finalContext = (runResult?.results as any)?.output || (runResult as any)?.output || runResult;
  return finalContext || context;
}

export const storyboardStep = createStep({
  id: 'storyboard-step',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    return await executeStoryboard(inputData);
  },
});
