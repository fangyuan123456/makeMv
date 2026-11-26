/**
 * tools/film-production/shot-motion-prompt-tool/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import { ShotMotionPromptInputSchema, shotMotionPromptStep } from './steps/01-motion-prompt/index.js';

export function createShotMotionPromptWorkflow() {
  return new Workflow({
    name: 'shot-motion-prompt-workflow',
    triggerSchema: ShotMotionPromptInputSchema,
  })
    .step(shotMotionPromptStep)
    .commit();
}
