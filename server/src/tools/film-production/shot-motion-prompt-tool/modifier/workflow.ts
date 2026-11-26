/**
 * tools/film-production/shot-motion-prompt-tool/modifier/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import { ShotMotionPromptModifierInputSchema, shotMotionPromptModifierStep } from './index.js';

export function createShotMotionPromptModifierWorkflow() {
  return new Workflow({
    name: 'shot-motion-prompt-modifier-workflow',
    triggerSchema: ShotMotionPromptModifierInputSchema,
  })
    .step(shotMotionPromptModifierStep)
    .commit();
}
