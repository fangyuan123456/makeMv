/**
 * workflows/steps/plan-gdd.step.ts
 * 步骤一：策划案 (GDD) 智能推演 - 基于 Mastra 官方 createStep 规范
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { plannerAgent, planGDDWithAgent } from '../../agents/planner/planner.agent.js';
import { GDDSchema, type GDDArtifact } from '../../agents/planner/schema.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { createProgressReporter } from '../../workflow-engine/progress.js';

export const planGddStepInputSchema = z.object({
  projectId: z.string(),
  userPrompt: z.string(),
  taskId: z.string().optional(),
});

export const planGddStepOutputSchema = z.object({
  projectId: z.string(),
  gdd: GDDSchema,
});

export type PlanGddStepInput = z.infer<typeof planGddStepInputSchema>;
export type PlanGddStepOutput = z.infer<typeof planGddStepOutputSchema>;

/**
 * 步骤一核心业务推演逻辑
 */
export async function executePlanGddStep(input: PlanGddStepInput): Promise<PlanGddStepOutput> {
  const { projectId, userPrompt, taskId = 'task_plan_gdd' } = input;
  const report = createProgressReporter(projectId, taskId);

  report(15, '正在深度剖析用户意图与戏剧核心矛盾...');
  report(40, '正在构筑全局状态机（数值变量、门禁旗标、线索背包）...');

  // 1. 调用 Mastra 官方原生策划 Agent 结构化推演
  const gdd = await planGDDWithAgent(userPrompt, plannerAgent);

  report(80, '正在构建有向流程树 (DAG) 与倒计时选择窗口...');

  // 2. 存入 ProjectStore 单一事实来源
  const store = ProjectStore.getInstance();
  store.setArtifact(projectId, 'gdd', gdd);

  report(100, `策划案《${gdd.title}》推演完成，等待创作者审批`);

  return {
    projectId,
    gdd,
  };
}

/**
 * Mastra 官方原生 Step 实例
 */
export const planGddStep = createStep({
  id: 'plan-gdd',
  description: '推演互动游戏系统策划案 (GDD)',
  inputSchema: planGddStepInputSchema,
  outputSchema: planGddStepOutputSchema,
  execute: async ({ context, runId }) => {
    return await executePlanGddStep({
      projectId: context.projectId,
      userPrompt: context.userPrompt,
      taskId: context.taskId || runId,
    });
  },
});
