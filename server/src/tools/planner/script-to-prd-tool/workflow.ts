/**
 * tools/planner/script-to-prd-tool/workflow.ts
 * 剧本资产工程解析工作流 (Script To PRD Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import { ExtractStepInputSchema, extractScriptStep } from './steps/01-extract/index.js';
import { synthesizePrdStep } from './steps/02-synthesize/index.js';

export function createScriptToPrdWorkflow() {
  return new Workflow({
    name: 'script-to-prd-workflow',
    triggerSchema: ExtractStepInputSchema,
  })
    .step(extractScriptStep)
    .then(synthesizePrdStep)
    .commit();
}
