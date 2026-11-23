/**
 * tools/film-production/shot-prompt-tool/workflow.ts
 * 单镜首帧生图词推演工作流 (Shot Prompt Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import { ShotPromptInputSchema, shotPromptStep } from './steps/01-prompt/index.js';
import { ShotPromptModifierInputSchema, shotPromptModifierStep } from './modifier/index.js';

export function createShotPromptWorkflow() {
  return new Workflow({
    name: 'shot-prompt-workflow',
    triggerSchema: ShotPromptInputSchema,
  })
    .step(shotPromptStep)
    .commit();
}

export function createShotPromptModifierWorkflow() {
  return new Workflow({
    name: 'shot-prompt-modifier-workflow',
    triggerSchema: ShotPromptModifierInputSchema,
  })
    .step(shotPromptModifierStep)
    .commit();
}
