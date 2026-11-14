/**
 * tools/film-production/03-character-portrait-tool/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import { CharacterPortraitStepInputSchema, characterPortraitStep } from './steps/01-render/index.js';

export function createCharacterPortraitWorkflow() {
  return new Workflow({
    name: 'character-portrait-workflow',
    triggerSchema: CharacterPortraitStepInputSchema,
  })
    .step(characterPortraitStep)
    .commit();
}
