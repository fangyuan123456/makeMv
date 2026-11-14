/**
 * tools/film-production/07-shot-video-tool/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import {
  shotVideoStep,
  ShotVideoStepInputSchema,
} from './steps/01-render/index.js';

export function createShotVideoWorkflow() {
  return new Workflow({
    name: 'shot-video-workflow',
    triggerSchema: ShotVideoStepInputSchema,
  })
    .step(shotVideoStep)
    .commit();
}
