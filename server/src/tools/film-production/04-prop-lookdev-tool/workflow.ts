/**
 * tools/film-production/04-prop-lookdev-tool/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import { PropLookdevStepInputSchema, propLookdevStep } from './steps/01-render/index.js';

export function createPropLookdevWorkflow() {
  return new Workflow({
    name: 'prop-lookdev-workflow',
    triggerSchema: PropLookdevStepInputSchema,
  })
    .step(propLookdevStep)
    .commit();
}
