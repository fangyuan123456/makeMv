/**
 * agents/planner/steps/branch-derivation/step.ts
 * 分支剧本推演工序 (deriveBranchesStep) - 基于 Mastra 官方微内核原生 Step
 *
 * 核心哲学：
 * 纯粹认知解耦：零 projectId 基础设施污染！
 * 驱动核心：调用反向拓扑层级优先调度引擎 (runTopologyBranchDerivation)。
 */

import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import {
  BranchDerivationInputSchema,
  BranchDerivationOutputSchema,
  type BranchDerivationInput,
  type BranchDerivationOutput,
} from './schema.js';
import { buildSingleBranchSystemPrompt } from './prompt.js';
import { runTopologyBranchDerivation } from './topology-runner.js';

/**
 * 创建单切口专职分支编剧 Agent
 */
export function createBranchDramatistAgent(): Agent {
  return new Agent({
    name: 'branch-dramatist-agent',
    instructions: buildSingleBranchSystemPrompt(),
    model: LLMProvider.getModel(),
  });
}

/**
 * 执行分支剧本推演：反向拓扑驱动
 */
export async function executeDeriveBranchesStep(
  input: BranchDerivationInput,
  agent: Agent = createBranchDramatistAgent()
): Promise<BranchDerivationOutput> {
  const { title, clips, spineScript, outlineSummary } = input;
  const branches = await runTopologyBranchDerivation(title, clips, agent, spineScript, outlineSummary);
  return {
    title,
    clips,
    branches,
  };
}

/**
 * Mastra 官方原生 Step 实例
 */
export const deriveBranchesStep = createStep({
  id: 'derive-branches',
  inputSchema: BranchDerivationInputSchema,
  outputSchema: BranchDerivationOutputSchema,
  execute: async ({ context }) => {
    return await runTaskRecordedStep('derive-branches', async () => {
      const ctx = (context as any) || {};
      const projectId = ctx.projectId || ctx.triggerData?.projectId;
      const store = ProjectStore.getInstance();
      const sliceOutput = projectId ? store.getArtifact<any>(projectId, 'planner_clips') : null;
      const spineOutput = projectId ? store.getArtifact<any>(projectId, 'planner_spine') : null;
      const trigger = ctx.triggerData || {};
      const title =
        ctx.title ||
        sliceOutput?.title ||
        spineOutput?.title ||
        trigger.title ||
        '未命名短剧';
      const clips = ctx.clips || sliceOutput?.clips || trigger.clips || [];
      const spineScript: string =
        ctx.spineScript ||
        spineOutput?.spineScript ||
        trigger.spineScript ||
        '';
      const outline = projectId ? store.getArtifact<any>(projectId, 'planner_outline') : null;
      const result = await executeDeriveBranchesStep({ title, clips, spineScript, outlineSummary: outline ? JSON.stringify(outline, null, 2) : undefined });
      if (projectId) store.setArtifact(projectId, 'planner_branches', result);
      return result;
    });
  },
});
