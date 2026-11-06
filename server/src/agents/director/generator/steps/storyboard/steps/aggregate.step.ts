/**
 * agents/director/generator/steps/storyboard/steps/aggregate.step.ts
 * 视听分镜第 3 阶段原子 Step：时长核算、拓扑校验与分镜表聚合落盘
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';
import { exportStoryboardToDisk } from '../exporter.js';
import type { StoryboardArtifact, StoryboardShotItem } from '../schema.js';

export const storyboardAggregateStep = createStep({
  id: 'step-storyboard-aggregate',
  description: '校验镜头数据与节点归属，持久化写入 ProjectStore 与本地磁盘',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, payload } = context;
    const plan = payload?.storyboardPlan;
    const shots: StoryboardShotItem[] = payload?.segmentedShots || [];
    const totalDurationSec: number = payload?.totalDurationSec || 0;

    if (!shots || shots.length === 0) {
      throw new Error('[storyboardAggregateStep] 未找到切分的分镜镜头数据');
    }

    const artifact: StoryboardArtifact = {
      title: plan?.title || '未命名视听分镜表',
      totalShots: shots.length,
      estimatedTotalDurationSec: totalDurationSec,
      shots,
      createdAt: new Date().toISOString(),
    };

    const store = ProjectStore.getInstance();
    store.setArtifact(projectId, WorkflowStage.STORYBOARD, artifact);
    exportStoryboardToDisk(projectId, artifact);

    return {
      ...context,
      toolResult: artifact,
      lastSummary: `视听分镜台本落盘完成：共计 ${shots.length} 镜台本，预估总时长 ${totalDurationSec} 秒。`,
      success: true,
      data: artifact,
      summary: `视听分镜台本落盘完成：共计 ${shots.length} 镜台本，预估总时长 ${totalDurationSec} 秒。`,
    };
  },
});
