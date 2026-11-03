/**
 * mastra/workflows/pipeline.workflow.ts
 * 基于 Mastra 官方微内核构建的互动影游全链路工业生产工作流 (Pipeline Workflow SSOT)
 * 
 * 核心特性：
 * 1. 串联 8 大真实视听工序 Steps 与审查官质检 Step；
 * 2. 原生消费 suspend / resume 人在回路原语，杜绝伪挂起；
 * 3. 严格数据契约约束，拒绝脏数据隐式推进。
 */

import { createWorkflow } from '@mastra/core/workflows';
import {
  WorkflowContextSchema,
  storyBibleStep,
  characterPortraitStep,
  sceneScriptStep,
  storyboardStep,
  keyframeReferenceStep,
  videoProductionStep,
  criticReviewStep,
  fmvPackagingStep,
} from './steps/stage-steps.js';

export const pipelineWorkflow = createWorkflow({
  id: 'director-pipeline-workflow',
  description: '互动影游全链路影视工业级推演、生成、质检与母带装配工作流',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
});

pipelineWorkflow
  .then(storyBibleStep)
  .then(criticReviewStep)
  .then(characterPortraitStep)
  .then(sceneScriptStep)
  .then(storyboardStep)
  .then(keyframeReferenceStep)
  .then(videoProductionStep)
  .then(fmvPackagingStep)
  .commit();

export * from './steps/stage-steps.js';
