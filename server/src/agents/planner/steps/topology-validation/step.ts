/**
 * agents/planner/steps/topology-validation/step.ts
 * 图论拓扑门禁校验原子工序 (validateTopologyStep) - 基于 Mastra 官方微内核原生 Step
 *
 * 核心架构：
 * 1. 显式门禁切面：作为工序第 5 步，独立承载三幕节拍与分支网络的图论体检；
 * 2. 刚性阻断优于隐式苟且：当存在致命拓扑错误时，直接报错阻断流水线带病向下流转；
 * 3. 纯函数解耦：只处理认知拓扑结构，不被外部 IO 污染。
 */

import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import {
  TopologyValidationInputSchema,
  TopologyValidationOutputSchema,
  type TopologyValidationInput,
  type TopologyValidationOutput,
} from './schema.js';
import { validatePipelineInputTopology } from './validator.js';
import {
  formatGddPrdToMarkdown,
  formatStoryScenesToMarkdown,
} from '../prd-synthesis/markdown-renderer.js';

export async function executeValidateTopologyStep(
  input: TopologyValidationInput
): Promise<TopologyValidationOutput> {
  const enrichedInput: TopologyValidationInput = {
    ...input,
    prdMarkdown:
      input.prdMarkdown ||
      (input.prd ? formatGddPrdToMarkdown(input.prd) : undefined),
    storyMarkdown:
      input.storyMarkdown ||
      (input.clips && input.clips.length > 0
        ? formatStoryScenesToMarkdown(input.clips, input.branches || [])
        : undefined),
  };
  const result = validatePipelineInputTopology(enrichedInput);

  if (!result.valid) {
    const errorDetails = result.errors.map((e, idx) => `${idx + 1}. ${e}`).join('\n');
    console.error(`[TopologyValidationStep] 拓扑门禁拦截失败：\n${errorDetails}`);
    // 刚性阻断：抛出结构化错误迫使工作流反思与自愈
    throw new Error(`[TopologyValidationStep] 剧情拓扑不合规，阻断流水线推进:\n${errorDetails}`);
  }

  if (result.warnings.length > 0) {
    console.warn(`[TopologyValidationStep] 拓扑可玩性告警:\n${result.warnings.join('\n')}`);
  }

  return {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
    metrics: result.metrics,
    title: input.title,
    clips: input.clips || [],
    branches: input.branches || [],
    gdd: input.gdd,
  };
}

/**
 * Mastra 原生原子 Step 实例 (第 5 工序)
 */
export const validateTopologyStep = createStep({
  id: 'validate-topology-step',
  description: '全剧三幕节拍与剧情分支图论静态拓扑门禁校验',
  inputSchema: TopologyValidationInputSchema,
  outputSchema: TopologyValidationOutputSchema,
  execute: async ({ context }) => {
    return await runTaskRecordedStep('validate-topology-step', async () => {
      const ctx = (context as any) || {};
      const projectId = ctx.projectId || ctx.triggerData?.projectId;
      const store = ProjectStore.getInstance();
      const sliceOutput = projectId ? store.getArtifact<any>(projectId, 'planner_clips') : null;
      const branchOutput = projectId ? store.getArtifact<any>(projectId, 'planner_branches') : null;
      const prdOutput = projectId ? store.getArtifact<any>(projectId, 'planner_prd') : null;

      const title =
        ctx.title ||
        prdOutput?.title ||
        branchOutput?.title ||
        sliceOutput?.title ||
        '未命名短剧';
      const clips =
        ctx.clips ||
        sliceOutput?.clips ||
        branchOutput?.clips ||
        [];
      const branches =
        ctx.branches ||
        branchOutput?.branches ||
        [];
      const prd = ctx.prd || prdOutput?.prd;
      const gdd = ctx.gdd;

      const result = await executeValidateTopologyStep({
        title,
        clips,
        branches,
        prd,
        gdd,
      });
      if (projectId) store.setArtifact(projectId, 'planner_validation', result);
      return result;
    });
  },
});
