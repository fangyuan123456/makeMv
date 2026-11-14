/**
 * tools/film-production/06-shot-keyframe-tool/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import {
  shotKeyframeStep,
  ShotKeyframeStepInputSchema,
} from './steps/01-render/index.js';

export function createShotKeyframeWorkflow() {
  return new Workflow({
    name: 'shot-keyframe-workflow',
    triggerSchema: ShotKeyframeStepInputSchema,
  })
    .step(shotKeyframeStep)
    .commit();
}
