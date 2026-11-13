import { Workflow } from '@mastra/core/workflows';
import { storyboardStep } from './steps/storyboard/step.js';
import { keyframeStep } from './steps/keyframe/step.js';
import { videoGenerationStep } from './steps/video-generation/step.js';
import { clipAssemblyStep } from './steps/clip-assembly/step.js';
import { keyframeEnhanceStep } from './steps/keyframe-enhance/step.js';

/** 影视生产编排入口；各 step 通过 ProjectStore 共享 film_spec。 */
export function createFilmAdapterWorkflow() {
  return new Workflow({ name: 'film-production-workflow', triggerSchema: storyboardStep.inputSchema })
    .step(storyboardStep)
    .then(keyframeStep)
    .then(keyframeEnhanceStep)
    .then(videoGenerationStep)
    .then(clipAssemblyStep)
    .commit();
}
