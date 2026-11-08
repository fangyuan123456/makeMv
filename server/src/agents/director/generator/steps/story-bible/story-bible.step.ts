/**
 * agents/pipeline/workflows/steps/story-bible/story-bible.step.ts
 * 影视工序第 1 阶段：故事圣经 (Story Bible Step SSOT)
 * 纯顺向流水线生成 (0 Modifier)
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext, shouldSkipUnchangedStep } from '../common.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { latestAssistantDigest } from '../../../../../project-store/conversation.js';
import { WorkflowStage } from '../../../../../types/index.js';
import { LLMRegistry } from '../../../../../llm/LLMRegistry.js';
import { generateStoryBible } from './generator.js';
import { exportStoryBibleToDisk } from './exporter.js';
import type { StoryBibleArtifact } from './schema.js';

export async function executeStoryBible(context: WorkflowContext): Promise<WorkflowContext> {
  const { projectId, feedback, overrideParams } = context;
  const store = ProjectStore.getInstance();
  const currentBible = store.getArtifact<StoryBibleArtifact>(projectId, WorkflowStage.NARRATIVE_DESIGN);

  // 1. 判断是否跳过
  const skipCheck = shouldSkipUnchangedStep(projectId, WorkflowStage.NARRATIVE_DESIGN, 'storyBibleStep', context);
  if (skipCheck.shouldSkip) {
    return {
      ...context,
      toolResult: skipCheck.existingArtifact || currentBible,
      lastSummary: '故事圣经：已跳过未变更工序并复用既有资产。',
    };
  }

  const llm = LLMRegistry.get();
  const project = store.getProject(projectId);

  // 提取总导演吸收创作者所有修改后总结输出的最新剧本方案 (拿最后一个对话，信噪比最高且无历史噪音)
  const dialogueHistory = latestAssistantDigest(projectId, context.sessionId);

  // 2. 顺向初稿推演生成
  const resultBible = await generateStoryBible(llm, {
    projectId,
    idea: overrideParams?.idea || overrideParams?.prompt || feedback || project?.meta?.idea || '现代互动短剧叙事架构',
    style: overrideParams?.style || project?.meta?.style || '电影质感，冷色调，悬疑叙事',
    userFeedback: feedback,
    dialogueHistory,
  });

  // 3. 写入黑板与持久化
  store.setArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN, resultBible);
  exportStoryBibleToDisk(projectId, resultBible, store);

  return {
    ...context,
    toolResult: resultBible,
    lastSummary: `故事圣经初稿推演完成：确立核心角色 ${resultBible.characters?.length || 0} 位，生成黄金三幕骨架。`,
  };
}

export const storyBibleStep = createStep({
  id: 'story-bible-step',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    return await executeStoryBible(inputData);
  },
});
