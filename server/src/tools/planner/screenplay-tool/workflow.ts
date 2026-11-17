/**
 * tools/planner/screenplay-tool/workflow.ts
 * 互动影游全景剧本生成工作流 (Screenplay Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import { PremiseStepInputSchema, premiseStep } from './steps/01-premise/index.js';
import { screenplayStep } from './steps/02-screenplay/index.js';
import { ScreenplayModifierInputSchema, screenplayModifierStep } from './modifier/index.js';

/**
 * 0 到 1 正向剧本批量推演工作流 (Generator Workflow)
 */
export function createScreenplayWorkflow() {
  return new Workflow({
    name: 'screenplay-generation-workflow',
    triggerSchema: PremiseStepInputSchema,
  })
    .step(premiseStep)
    .then(screenplayStep)
    .commit();
}

/**
 * 局部文本 Patch 精修工作流 (Modifier Workflow)
 * 与正向生成彻底解耦，专职对已有剧本执行外科手术微调
 */
export function createScreenplayModifierWorkflow() {
  return new Workflow({
    name: 'screenplay-modifier-workflow',
    triggerSchema: ScreenplayModifierInputSchema,
  })
    .step(screenplayModifierStep)
    .commit();
}
