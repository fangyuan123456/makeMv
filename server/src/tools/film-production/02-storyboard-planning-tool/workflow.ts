/**
 * tools/film-production/02-storyboard-planning-tool/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import { StoryboardPlanningStepInputSchema, storyboardPlanningStep } from './steps/01-plan/index.js';

export function createStoryboardPlanningWorkflow() {
  return new Workflow({
    name: 'storyboard-planning-workflow',
    triggerSchema: StoryboardPlanningStepInputSchema,
  })
    .step(storyboardPlanningStep)
    .commit();
}
