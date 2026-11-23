/**
 * tools/film-production/shooting-script-tool/workflow.ts
 * 导演摄制台本工作流 (Shooting Script Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import { ShootingScriptInputSchema } from './schema.js';
import { shootingScriptStep } from './step.js';
import {
  ShootingScriptModifierInputSchema,
  shootingScriptModifierStep,
} from './modifier/index.js';

export function createShootingScriptWorkflow() {
  return new Workflow({
    name: 'shooting-script-workflow',
    triggerSchema: ShootingScriptInputSchema,
  })
    .step(shootingScriptStep)
    .commit();
}

export function createShootingScriptModifierWorkflow() {
  return new Workflow({
    name: 'shooting-script-modifier-workflow',
    triggerSchema: ShootingScriptModifierInputSchema,
  })
    .step(shootingScriptModifierStep)
    .commit();
}
