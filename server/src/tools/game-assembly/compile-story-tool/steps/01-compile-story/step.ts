/**
 * tools/game-assembly/compile-story-tool/steps/01-compile-story/step.ts
 */

import { createStep } from '@mastra/core/workflows';
import { executeCompileStoryOnly } from '../../../shared/story-compiler.js';
import {
  CompileStoryInputSchema,
  CompileStoryOutputSchema,
} from './schema.js';

export const compileStoryStep = createStep({
  id: 'compile-story-step',
  description: '编译同步 story.json 与确定性底座 runtime/*',
  inputSchema: CompileStoryInputSchema,
  outputSchema: CompileStoryOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx.inputData || ctx;
    return executeCompileStoryOnly({
      projectId: input.projectId,
      title: input.title,
    });
  },
});
