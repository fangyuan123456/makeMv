/**
 * tools/game-assembly/compile-story-tool/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import {
  CompileStoryInputSchema,
  compileStoryStep,
} from './steps/01-compile-story/index.js';

export function createCompileStoryWorkflow() {
  return new Workflow({
    name: 'game-compile-story-workflow',
    triggerSchema: CompileStoryInputSchema,
  })
    .step(compileStoryStep)
    .commit();
}
