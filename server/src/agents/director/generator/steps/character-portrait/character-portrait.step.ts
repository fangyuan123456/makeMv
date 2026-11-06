/**
 * agents/director/generator/steps/character-portrait/character-portrait.step.ts
 * 影视工序第 2 阶段：角色定妆 (Character Portrait Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext, shouldSkipUnchangedStep } from '../common.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../types/index.js';
import { characterPortraitSubWorkflow } from './character-portrait.workflow.js';
import type { CharacterPortraitArtifact } from './schema.js';

export async function executeCharacterPortrait(context: WorkflowContext): Promise<WorkflowContext> {
  const { projectId } = context;
  const store = ProjectStore.getInstance();
  const currentPortraits = store.getArtifact<CharacterPortraitArtifact>(projectId, WorkflowStage.CHARACTER_DESIGN);

  // 1. 检查是否跳过
  const skipCheck = shouldSkipUnchangedStep(projectId, WorkflowStage.CHARACTER_DESIGN, 'characterPortraitStep', context);
  if (skipCheck.shouldSkip) {
    return {
      ...context,
      toolResult: skipCheck.existingArtifact || currentPortraits,
      lastSummary: '角色定妆：已跳过未变更工序并复用既有资产。',
    };
  }

  // 2. 调用定妆子工作流执行渲染
  const run = await (characterPortraitSubWorkflow as any).createRun();
  const runResult = await run.start({
    inputData: context,
  });

  const finalContext = (runResult?.results as any)?.output || (runResult as any)?.output || runResult;
  return finalContext || context;
}

export const characterPortraitStep = createStep({
  id: 'character-portrait-step',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    return await executeCharacterPortrait(inputData);
  },
});
