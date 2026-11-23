/**
 * tools/film-production/storyboard-breakdown-tool/workflow.ts
 * 单幕分镜剧本拆分工作流 (Storyboard Breakdown Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import {
  StoryboardBreakdownInputSchema,
  storyboardBreakdownStep,
} from './steps/01-breakdown/index.js';
import {
  StoryboardBreakdownModifierInputSchema,
  storyboardBreakdownModifierStep,
} from './modifier/index.js';

export function createStoryboardBreakdownWorkflow() {
  return new Workflow({
    name: 'storyboard-breakdown-workflow',
    triggerSchema: StoryboardBreakdownInputSchema,
  })
    .step(storyboardBreakdownStep)
    .commit();
}

export function createStoryboardBreakdownModifierWorkflow() {
  return new Workflow({
    name: 'storyboard-breakdown-modifier-workflow',
    triggerSchema: StoryboardBreakdownModifierInputSchema,
  })
    .step(storyboardBreakdownModifierStep)
    .commit();
}
