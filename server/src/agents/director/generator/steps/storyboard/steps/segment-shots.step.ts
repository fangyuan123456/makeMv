/**
 * agents/director/generator/steps/storyboard/steps/segment-shots.step.ts
 * 视听分镜第 2 阶段原子 Step：视听镜头分块批量拆解与时长核算
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { LLMRegistry } from '../../../../../../llm/LLMRegistry.js';
import { generateStoryboardBatch } from '../generator.js';

export const storyboardSegmentStep = createStep({
  id: 'step-storyboard-segment',
  description: '调用大模型批量将场次细化解构为专业电影视听分镜台本',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, payload } = context;
    const plan = payload?.storyboardPlan;

    if (!plan) {
      throw new Error('[storyboardSegmentStep] 缺少前置分镜规划上下文 (storyboardPlan)');
    }

    const llm = LLMRegistry.get();
    const { shots, totalDurationSec } = await generateStoryboardBatch(llm, {
      projectId,
      title: plan.title,
      scenes: plan.scenes,
      userFeedback: plan.userFeedback,
      effectiveConstraints: plan.effectiveConstraints,
      chunkSize: 2,
    });

    return {
      ...context,
      payload: {
        ...payload,
        segmentedShots: shots,
        totalDurationSec,
      },
      lastSummary: `视听镜头解构完成：共切分 ${shots.length} 个镜头，预估总时长 ${totalDurationSec} 秒。`,
    };
  },
});
