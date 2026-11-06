/**
 * agents/director/generator/steps/story-bible/steps/graph.step.ts
 * 故事圣经 Step 2：网状分支剧情拓扑与核心宏观抉择点一体化编译原子步骤 (Graph Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { LLMRegistry } from '../../../../../../llm/LLMRegistry.js';
import { generateStoryGraphAndPivots } from '../generator.js';
import { StoryBibleWorkflowContextSchema } from './spine.step.js';
import type { StorySpineOutput } from '../schema.js';

/**
 * 步骤 2：网状分支剧情拓扑与核心宏观抉择点一体化编译 (Step 2)
 */
export const storyGraphStep = createStep({
  id: 'step-story-graph',
  description: '编译网状分支图谱与核心宏观抉择点 (抉择与节点强互锁)',
  inputSchema: StoryBibleWorkflowContextSchema,
  outputSchema: StoryBibleWorkflowContextSchema,
  execute: async ({ inputData }) => {
    if (inputData.isSkipped) {
      return inputData;
    }

    const llm = LLMRegistry.get();
    const { storyGraph, pivotPoints } = await generateStoryGraphAndPivots(
      llm,
      inputData.spine as StorySpineOutput,
      inputData.feedback,
      inputData.projectId
    );

    return {
      ...inputData,
      storyGraph,
      pivotPoints,
    };
  },
});
