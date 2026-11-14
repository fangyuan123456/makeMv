/**
 * tools/film-production/05-scene-atmosphere-tool/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import {
  sceneAtmosphereStep,
  SceneAtmosphereStepInputSchema,
} from './steps/01-render/index.js';

export function createSceneAtmosphereWorkflow() {
  return new Workflow({
    name: 'scene-atmosphere-workflow',
    triggerSchema: SceneAtmosphereStepInputSchema,
  })
    .step(sceneAtmosphereStep)
    .commit();
}
