/**
 * agents/director/generator/steps/story-bible/steps/character-profiles.step.ts
 * 故事圣经 Step 3：核心角色档案小传与全量资产落盘原子步骤 (Characters Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';
import { LLMRegistry } from '../../../../../../llm/LLMRegistry.js';
import { generateCharacterProfiles } from '../generator.js';
import { exportStoryBibleToDisk } from '../exporter.js';
import { StoryBibleWorkflowContextSchema } from './spine.step.js';
import type {
  StorySpineOutput,
  StoryGraphOutput,
  PivotPointsOutput,
  StoryBibleArtifact,
} from '../schema.js';

/**
 * 步骤 3：核心角色档案小传与全量资产落盘 (Step 3)
 */
export const characterProfilesStep = createStep({
  id: 'step-character-profiles',
  description: '推演核心角色档案与视觉造型参数，完成全量资产落盘',
  inputSchema: StoryBibleWorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    if (inputData.isSkipped) {
      return inputData;
    }

    const llm = LLMRegistry.get();
    const store = ProjectStore.getInstance();
    const { projectId, spine, storyGraph, pivotPoints, feedback } = inputData;

    const characters = await generateCharacterProfiles(
      llm,
      spine as StorySpineOutput,
      storyGraph as StoryGraphOutput,
      feedback,
      projectId
    );

    const characterNames = characters.map((c: any) => c.name);

    const resultBible: StoryBibleArtifact = {
      title: spine.title,
      theme: spine.theme,
      style: spine.style,
      logline: spine.logline,
      sellingPoints: spine.sellingPoints,
      goldenSpine: spine.goldenSpine,
      pivotPoints: pivotPoints as PivotPointsOutput,
      characters,
      characterNames,
      storyGraph: storyGraph as StoryGraphOutput,
      createdAt: new Date().toISOString(),
    };

    // 写入黑板与磁盘持久化
    store.setArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN, resultBible);
    exportStoryBibleToDisk(projectId, resultBible, store);

    return {
      ...inputData,
      toolResult: resultBible,
      lastSummary: `故事圣经推演完成：确立核心角色 ${characters.length} 位，生成黄金三幕与网状分支图谱。`,
    };
  },
});
