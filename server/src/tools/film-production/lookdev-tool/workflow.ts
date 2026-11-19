import { Workflow } from '@mastra/core/workflows';
import { createLookdevRenderStep, type RenderLookdevTarget } from './steps/01-render/step.js';
import { LookdevStepInputSchema } from './steps/01-render/schema.js';

export function createLookdevWorkflow(renderTarget: RenderLookdevTarget) {
  return new Workflow({
    name: 'lookdev-workflow',
    triggerSchema: LookdevStepInputSchema,
  }).step(createLookdevRenderStep(renderTarget)).commit();
}
