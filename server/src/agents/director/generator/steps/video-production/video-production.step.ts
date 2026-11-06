/**
 * agents/director/generator/steps/video-production/video-production.step.ts
 * 影视工序第 6 阶段：动态视频切片 (Video Production Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext, shouldSkipUnchangedStep } from '../common.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../types/index.js';
import { videoProductionSubWorkflow } from './video-production.workflow.js';
import type { VideoProductionArtifact } from './schema.js';

export async function executeVideoProduction(context: WorkflowContext): Promise<WorkflowContext> {
  const { projectId } = context;
  const store = ProjectStore.getInstance();
  const currentVideos = store.getArtifact<VideoProductionArtifact>(projectId, WorkflowStage.VIDEO_PRODUCTION);

  // 1. 检查是否跳过
  const skipCheck = shouldSkipUnchangedStep(projectId, WorkflowStage.VIDEO_PRODUCTION, 'videoProductionStep', context);
  if (skipCheck.shouldSkip) {
    return {
      ...context,
      toolResult: skipCheck.existingArtifact || currentVideos,
      lastSummary: '动态视频：已跳过未变更工序并复用既有资产。',
    };
  }

  // 2. 调用视频生产子工作流
  const run = await (videoProductionSubWorkflow as any).createRun();
  const runResult = await run.start({
    inputData: context,
  });

  const finalContext = (runResult?.results as any)?.output || (runResult as any)?.output || runResult;
  return finalContext || context;
}

export const videoProductionStep = createStep({
  id: 'video-production-step',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    return await executeVideoProduction(inputData);
  },
});
