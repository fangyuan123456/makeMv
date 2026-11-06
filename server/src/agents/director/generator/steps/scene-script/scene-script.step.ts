/**
 * agents/director/generator/steps/scene-script/scene-script.step.ts
 * 影视工序第 3 阶段：分场剧本 (Scene Script Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext, shouldSkipUnchangedStep } from '../common.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../types/index.js';
import { sceneScriptSubWorkflow } from './scene-script.workflow.js';
import type { SceneScriptArtifact } from './schema.js';

export async function executeSceneScript(context: WorkflowContext): Promise<WorkflowContext> {
  const { projectId } = context;
  const store = ProjectStore.getInstance();
  const currentScript = store.getArtifact<SceneScriptArtifact>(projectId, WorkflowStage.SCENE_SCRIPT);

  // 1. 判断是否跳过
  const skipCheck = shouldSkipUnchangedStep(projectId, WorkflowStage.SCENE_SCRIPT, 'sceneScriptStep', context);
  if (skipCheck.shouldSkip) {
    return {
      ...context,
      toolResult: skipCheck.existingArtifact || currentScript,
      lastSummary: '分场剧本：已跳过未变更工序并复用既有资产。',
    };
  }

  // 2. 调用分场剧本子工作流
  const run = await (sceneScriptSubWorkflow as any).createRun();
  const runResult = await run.start({
    inputData: context,
  });

  const finalContext = (runResult?.results as any)?.output || (runResult as any)?.output || runResult;
  return finalContext || context;
}

export const sceneScriptStep = createStep({
  id: 'scene-script-step',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    return await executeSceneScript(inputData);
  },
});
