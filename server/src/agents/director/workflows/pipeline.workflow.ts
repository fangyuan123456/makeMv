/**
 * agents/director/workflows/pipeline.workflow.ts
 * 互动影游全流程声明式生产流水线工作流 (Film Production Pipeline Workflow SSOT)
 * 
 * 核心架构特性：
 * 1. 采用 Mastra 原生 createWorkflow 链式声明编排，流程因果关系一目了然；
 * 2. 极大方便流程调整与并发改造（可按需通过 .step().step() 拆解为并行分支）；
 * 3. 官方原生对接 Mastra Studio，直接渲染完整的动态 DAG 流程图拓扑。
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
  fmvPackagingStep,
} from './steps/stage-steps.js';

/**
 * 互动影游核心生产流水线工作流 (Mastra Workflow SSOT)
 * 
 * 提示（如何轻松改成并发）：
 * 若希望【角色定妆 (characterPortraitStep)】与【分场剧本 (sceneScriptStep)】并行推进，可按 Mastra 官方并发语法调整为：
 * createWorkflow(...)
 *   .then(storyBibleStep)
 *   .step(characterPortraitStep)
 *   .step(sceneScriptStep)
 *   .after([characterPortraitStep, sceneScriptStep])
 *   .then(storyboardStep)...
 */
export const filmProductionPipelineWorkflow = createWorkflow({
  id: 'film-production-pipeline',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
})
  .then(storyBibleStep)
  .then(characterPortraitStep)
  .then(sceneScriptStep)
  .then(storyboardStep)
  .then(keyframeReferenceStep)
  .then(videoProductionStep)
  .then(fmvPackagingStep)
  .commit();
