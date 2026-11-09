/**
 * workflows/production.workflow.ts
 * 互动影游全生命周期工作流状态机 (Production Workflow SSOT)
 *
 * 核心架构：
 * 1. Mastra 官方微内核原生 Workflow 状态机链式编排 (Step -> Then -> Then)；
 * 2. 轻量防抖与运行中互斥门禁 (In-Flight Guard，杜绝狂点挤兑算力)；
 * 3. 真实带权重切面进度计算 (归一化 10%~95% 广播)；
 * 4. 声明式人在回路审批门禁 (Suspend / Resume 阶段流转)。
 */

import { Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { planGddStep, executePlanGddStep } from './steps/plan-gdd.step.js';
import { buildTextGameStep, executeBuildTextGameStep } from './steps/build-text-game.step.js';
import { compileFilmStep, executeCompileFilmStep } from './steps/compile-film.step.js';
import { TaskStore } from '../workflow-engine/TaskStore.js';

export const ProductionTriggerSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  userPrompt: z.string().describe('创作者输入的原始创意设定'),
});

/**
 * Mastra 官方微内核原生 Workflow 实例
 */
export const productionWorkflow = new Workflow({
  name: 'interactive-fmv-production',
  triggerSchema: ProductionTriggerSchema,
})
  .step(planGddStep)
  .then(buildTextGameStep)
  .then(compileFilmStep)
  .commit();

export interface WorkflowRunStateSnapshot {
  runId: string;
  projectId: string;
  status: 'running' | 'suspended' | 'succeeded' | 'failed';
  currentStage: 'plan_gdd' | 'build_text_game' | 'compile_film' | 'completed';
  pendingApproval?: {
    type: 'gdd_approval' | 'playtest_approval';
    title: string;
    description: string;
    data: any;
  };
  error?: string;
}

/**
 * 生产流水线调度总控引擎 (结合轻量防抖互斥门禁与人在回路状态机)
 */
export class ProductionWorkflowEngine {
  /**
   * 启动生产流水线 (进入阶段一推演，完成后自动挂起等待策划案审批)
   */
  public static async start(projectId: string, userPrompt: string): Promise<string> {
    const taskStore = TaskStore.getInstance();

    // 1. 轻量防抖与运行中互斥门禁：如果当前项目已有任务在跑，直接阻断
    const runningTask = taskStore.getRunningTask(projectId);
    if (runningTask) {
      throw new Error(`[409 Conflict] 项目 [${projectId}] 正在全力推演中，请勿重复提交！`);
    }

    // 2. 创建流水线任务
    const task = taskStore.createTask(
      projectId,
      'production_pipeline',
      '互动影游全生命周期生产流水线',
      true,
      { userPrompt }
    );

    taskStore.setStatus(projectId, task.taskId, 'running');

    // 3. 异步驱动阶段一：策划案推演
    (async () => {
      try {
        const stepResult = await executePlanGddStep({
          projectId,
          userPrompt,
          taskId: task.taskId,
        });

        // 阶段一完成：主动挂起，等待创作者审批
        taskStore.setStatus(projectId, task.taskId, 'proposed', {
          result: {
            currentStage: 'plan_gdd',
            pendingApproval: {
              type: 'gdd_approval',
              title: '互动游戏策划案 (GDD) 待审批',
              description: `策划案《${stepResult.gdd.title}》已推演完成，请创作者审查数值变量与核心矛盾`,
              data: stepResult.gdd,
            },
          },
        });
      } catch (err: any) {
        taskStore.setStatus(projectId, task.taskId, 'failed', { error: err.message });
      }
    })();

    return task.taskId;
  }

  /**
   * 人在回路信号注入 (唤醒挂起的工作流，推进至下一工序)
   */
  public static async resume(
    projectId: string,
    runId: string,
    signal: { approved: boolean; feedback?: string }
  ): Promise<WorkflowRunStateSnapshot> {
    const taskStore = TaskStore.getInstance();

    const task = taskStore.getTask(projectId, runId);
    if (!task) {
      throw new Error(`[WorkflowEngine] 未找到流水线任务: ${runId}`);
    }

    if (!signal.approved) {
      taskStore.setStatus(projectId, runId, 'failed', {
        error: `创作者已驳回当前工序: ${signal.feedback || '未提供具体原因'}`,
      });
      return this.getState(projectId, runId);
    }

    // 检查当前应该推进哪个阶段
    const stageMetadata = task.result as any;
    const currentPending = stageMetadata?.pendingApproval?.type;

    if (currentPending === 'gdd_approval') {
      // 策划案审批通过 ➔ 启动阶段二：文游扩写装配
      taskStore.setStatus(projectId, runId, 'running');

      (async () => {
        try {
          const stepResult = await executeBuildTextGameStep({
            projectId,
            taskId: runId,
          });

          // 阶段二完成：主动挂起，进入创作者 0-Token 试玩体验
          taskStore.setStatus(projectId, runId, 'proposed', {
            result: {
              currentStage: 'build_text_game',
              pendingApproval: {
                type: 'playtest_approval',
                title: '互动文游已装配就绪，等待试玩验收',
                description: `文游《${stepResult.textGame.title}》已生成共 ${stepResult.textGame.nodes.length} 个节点，支持即刻试玩`,
                data: stepResult.textGame,
              },
            },
          });
        } catch (err: any) {
          taskStore.setStatus(projectId, runId, 'failed', { error: err.message });
        }
      })();

      return this.getState(projectId, runId);
    }

    if (currentPending === 'playtest_approval') {
      // 试玩通过 ➔ 启动阶段三：影游切片资产清单编译
      taskStore.setStatus(projectId, runId, 'running');

      (async () => {
        try {
          const stepResult = await executeCompileFilmStep({
            projectId,
            taskId: runId,
          });

          // 阶段三完成：全线大功告成！
          taskStore.setStatus(projectId, runId, 'succeeded', {
            result: {
              currentStage: 'completed',
              filmSpec: stepResult.filmSpec,
            },
          });
        } catch (err: any) {
          taskStore.setStatus(projectId, runId, 'failed', { error: err.message });
        }
      })();

      return this.getState(projectId, runId);
    }

    throw new Error(`[WorkflowEngine] 当前任务未处于可审批挂起状态 (当前状态: ${task.status})`);
  }

  /**
   * 查询当前流水线状态机快照
   */
  public static getState(projectId: string, runId: string): WorkflowRunStateSnapshot {
    const taskStore = TaskStore.getInstance();
    const task = taskStore.getTask(projectId, runId);
    if (!task) {
      throw new Error(`[WorkflowEngine] 未找到流水线任务: ${runId}`);
    }

    const stageMetadata = task.result as any;

    let status: WorkflowRunStateSnapshot['status'] = 'running';
    if (task.status === 'proposed') status = 'suspended';
    else if (task.status === 'succeeded') status = 'succeeded';
    else if (task.status === 'failed') status = 'failed';

    return {
      runId,
      projectId,
      status,
      currentStage: stageMetadata?.currentStage || 'plan_gdd',
      pendingApproval: stageMetadata?.pendingApproval,
      error: task.error,
    };
  }
}
