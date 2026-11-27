/**
 * tools/game-assembly/workflow.ts
 * 互动影游打包总装工作流 (Game Assembly Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import {
  techPlanStep,
  TechPlanStepInputSchema,
} from './steps/01-tech-plan/index.js';
import { codegenStep } from './steps/02-codegen/index.js';

export function createGameAssemblyWorkflow() {
  return new Workflow({
    name: 'game-assembly-workflow',
    triggerSchema: TechPlanStepInputSchema,
  })
    .step(techPlanStep)
    .then(codegenStep)
    .commit();
}
