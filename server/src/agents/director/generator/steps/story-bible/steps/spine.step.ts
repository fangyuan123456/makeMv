/**
 * agents/director/generator/steps/story-bible/steps/spine.step.ts
 * 故事圣经 Step 1：故事黄金三幕骨架原子推演步骤 (Spine Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { WorkflowContextSchema, shouldSkipUnchangedStep } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { latestAssistantDigest } from '../../../../../../project-store/conversation.js';
import { WorkflowStage } from '../../../../../../types/index.js';
import { LLMRegistry } from '../../../../../../llm/LLMRegistry.js';
import { generateStorySpine } from '../generator.js';
import type { StoryBibleArtifact } from '../schema.js';

export const StoryBibleWorkflowContextSchema = WorkflowContextSchema.extend({
  spine: z.any().optional(),
  storyGraph: z.any().optional(),
  pivotPoints: z.any().optional(),
  characters: z.array(z.any()).optional(),
  isSkipped: z.boolean().optional(),
  dialogueHistory: z.string().optional(),
});

export type StoryBibleWorkflowContext = z.infer<typeof StoryBibleWorkflowContextSchema>;

/**
 * 步骤 1：断点核验与黄金三幕骨架推演 (Step 1)
 */
export const storySpineStep = createStep({
  id: 'step-story-spine',
  description: '推演故事黄金三幕骨架 (确定主干大纲、悬念钩子与商业卖点)',
  inputSchema: WorkflowContextSchema,
  outputSchema: StoryBibleWorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId, feedback, overrideParams } = inputData;
    const store = ProjectStore.getInstance();
    const currentBible = store.getArtifact<StoryBibleArtifact>(projectId, WorkflowStage.NARRATIVE_DESIGN);

    // 1. 判断是否跳过
    const skipCheck = shouldSkipUnchangedStep(projectId, WorkflowStage.NARRATIVE_DESIGN, 'storyBibleStep', inputData);
    if (skipCheck.shouldSkip) {
      return {
        ...inputData,
        toolResult: skipCheck.existingArtifact || currentBible,
        isSkipped: true,
        lastSummary: '故事圣经：已跳过未变更工序并复用既有资产。',
      };
    }

    const llm = LLMRegistry.get();
    const project = store.getProject(projectId);

    // 提取总导演最新剧本沟通沉淀
    const dialogueHistory = latestAssistantDigest(projectId, inputData.sessionId);

    const spine = await generateStorySpine(llm, {
      projectId,
      idea: overrideParams?.idea || overrideParams?.prompt || feedback || project?.meta?.idea || '现代互动短剧叙事架构',
      style: overrideParams?.style || project?.meta?.style || '电影质感，冷色调，悬疑叙事',
      userFeedback: feedback,
      dialogueHistory,
    });

    return {
      ...inputData,
      spine,
      dialogueHistory,
      isSkipped: false,
    };
  },
});
