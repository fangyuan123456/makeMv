/**
 * tools/planner/screenplay-tool/workflow.ts
 * 互动影游全景剧本生成工作流 (Screenplay Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import { PremiseStepInputSchema, premiseStep } from './steps/01-premise/index.js';
import { screenplayStep } from './steps/02-screenplay/index.js';

export function createScreenplayWorkflow() {
  return new Workflow({
    name: 'screenplay-generation-workflow',
    triggerSchema: PremiseStepInputSchema,
  })
    .step(premiseStep)
    .then(screenplayStep)
    .commit();
}
