/**
 * tools/game-assembly/compile-story-tool/steps/01-compile-story/schema.ts
 */

import { z } from 'zod';

export const CompileStoryInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().optional().describe('作品名称'),
});

export type CompileStoryInput = z.infer<typeof CompileStoryInputSchema>;
export { CodegenStepOutputSchema as CompileStoryOutputSchema, type CodegenStepOutput as CompileStoryOutput } from '../../../assembly-tool/steps/02-codegen/schema.js';
