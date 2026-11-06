/**
 * agents/pipeline/workflows/steps/fmv-packaging/fmv-packaging.step.ts
 * 影视工序第 8 阶段：互动影游封包 (FMV Packaging Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext, shouldSkipUnchangedStep } from '../common.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../types/index.js';
import { compileFmvManifest } from './manifest-compiler.js';
import type { FMVManifest } from './schema.js';

export async function executeFmvPackaging(context: WorkflowContext): Promise<WorkflowContext> {
  const { projectId, overrideParams } = context;
  const store = ProjectStore.getInstance();
  const currentManifest = store.getArtifact<FMVManifest>(projectId, WorkflowStage.FMV_PACKAGING);

  // 1. 检查是否跳过
  const skipCheck = shouldSkipUnchangedStep(projectId, WorkflowStage.FMV_PACKAGING, 'fmvPackagingStep', context);
  if (skipCheck.shouldSkip) {
    return {
      ...context,
      toolResult: skipCheck.existingArtifact || currentManifest,
      lastSummary: '影游封包：已跳过未变更工序并复用既有资产。',
    };
  }

  // 2. 收集前序各工序资产
  const project = store.getProject(projectId);
  const bible = store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
  const storyboard = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
  const videoClips = store.getArtifact<any>(projectId, WorkflowStage.VIDEO_PRODUCTION);

  const rawNodes = bible?.storyGraph?.nodes || [];
  const storyboardShots = storyboard?.shots || [];
  const clips = videoClips?.clips || [];

  if (!clips || clips.length === 0) {
    throw new Error('未检测到有效的视频切片资产，无法进行母带封包！');
  }

  // 3. 编译封包 Manifest
  const compiled = compileFmvManifest({
    rawNodes,
    storyboardShots,
    clips,
    gameTitle: overrideParams?.title || project?.meta?.title || '互动影游',
  });

  // 4. 写入黑板
  store.setArtifact(projectId, WorkflowStage.FMV_PACKAGING, compiled.fmvManifest);

  const nodeCount = Object.keys(compiled.fmvManifest.nodes || {}).length;
  return {
    ...context,
    toolResult: compiled.fmvManifest,
    lastSummary: `互动影游封包完成：共链接 ${nodeCount} 个叙事节点，总时长约 ${compiled.totalDurationSec} 秒。`,
  };
}

export const fmvPackagingStep = createStep({
  id: 'fmv-packaging-step',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    return await executeFmvPackaging(inputData);
  },
});
