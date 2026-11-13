/**
 * workflows/steps/plan-gdd.step.ts
 * 步骤一：策划案 (GDD) 智能推演 - 基于 Mastra 官方 createStep 规范
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { GDDSchema } from '../../project-store/contracts/planner/index.js';
import { runPlannerWorkflow } from '../../agents/planner/planner.workflow.js';
import { createProgressReporter } from '../../workflow-engine/progress.js';

export const planGddStepInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  userPrompt: z.string().describe('创作者输入的创意需求与叙事意图'),
  taskId: z.string().optional().describe('任务追踪 ID'),
});

export const planGddStepOutputSchema = z.object({
  projectId: z.string(),
  gdd: GDDSchema,
});

export type PlanGddStepInput = z.infer<typeof planGddStepInputSchema>;
export type PlanGddStepOutput = z.infer<typeof planGddStepOutputSchema>;

/**
 * 步骤一核心业务推演逻辑 (阶段一执行唯一合法门面)
 * 原生驱动 plannerWorkflow (主干剧本 ➔ 互动切口 ➔ 分支推演 ➔ 全案 PRD)
 */
export async function executePlanGddStep(input: PlanGddStepInput): Promise<PlanGddStepOutput> {
  const { projectId, userPrompt, taskId = 'task_plan_gdd' } = input;
  const report = createProgressReporter(projectId, taskId);

  report(8, '正在启动阶段一策划流水线 (write-spine-script)...');

  // 调用阶段一 Mastra 微内核子工作流驱动引擎（通过 watch 随 5 大真实工序实时更新进度）
  const plannerOutput = await runPlannerWorkflow(
    { projectId, userPrompt },
    { onProgress: report }
  );

  report(100, `策划案《${plannerOutput.title}》推演完成，等待创作者审批`);

  return {
    projectId,
    gdd: plannerOutput.gdd,
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
