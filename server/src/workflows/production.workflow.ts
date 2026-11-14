/**
 * workflows/production.workflow.ts
 * 互动影游全生命周期工作流状态机 (Production Workflow SSOT)
 *
 * 核心架构：
 * 1. Mastra 官方微内核 Workflow 工厂 (createProductionWorkflow)，杜绝共享单例状态覆盖；
 * 2. 跨项目真并发 + 同项目 ProjectLaneScheduler 串行通道 + In-Flight 409 防抖；
 * 3. AbortController 全链路取消信号与 AsyncLocalStorage RunContext 透传；
 * 4. 明确状态语义 (queued / running / suspended / succeeded / failed / cancelled) 与启动中断自愈。
 */

import { Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { planGddStep, executePlanGddStep } from './steps/plan-gdd.step.js';
import {
  extractVisualSpecStep,
  executeExtractVisualSpecStep,
} from './steps/extract-visual-spec.step.js';
import {
  buildGameAssemblyStep,
  executeBuildGameAssemblyStep,
} from './steps/build-game-assembly.step.js';
import { compileFilmStep, executeCompileFilmStep } from './steps/compile-film.step.js';
import {
  executeAssetExtractionStep,
  executeStoryboardPlanningStep,
  executeStudioMasterWorkflow,
} from '../agents/film-production/index.js';
import { TaskStore } from '../workflow-engine/TaskStore.js';
import { dumpRunFailure } from '../utils/run-failure-log.js';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { ProjectLaneScheduler } from '../workflow-engine/concurrency.js';
import {
  RunAbortedError,
  isAbortError,
  withRunContext,
} from '../workflow-engine/run-context.js';

export const ProductionTriggerSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  userPrompt: z.string().describe('创作者输入的原始创意设定'),
});

/**
 * Mastra 官方微内核原生 Workflow 无状态工厂（用于容器注册与拓扑内省）
 */
export function createProductionWorkflow() {
  return new Workflow({
    name: 'interactive-fmv-production',
    triggerSchema: ProductionTriggerSchema,
  })
    .step(planGddStep)
    .then(extractVisualSpecStep)
    .then(compileFilmStep)
    .then(buildGameAssemblyStep)
    .commit();
}

export interface WorkflowRunStateSnapshot {
  runId: string;
  projectId: string;
  status: 'queued' | 'running' | 'suspended' | 'succeeded' | 'failed' | 'cancelled';
  currentStage: 'plan_gdd' | 'extract_visual_spec' | 'build_text_game' | 'compile_film' | 'completed';
  pendingApproval?: {
    type: 'gdd_approval' | 'lookdev_approval' | 'playtest_approval';
    title: string;
    description: string;
    data: any;
    validation?: { valid: boolean; errors: string[] };
  };
  error?: string;
}

/**
 * 生产流水线调度总控引擎 (多项目真并发 + 同项目串行通道 + 全链路可取消/恢复)
 */
export class ProductionWorkflowEngine {
  private static laneScheduler = new ProjectLaneScheduler();
  private static activeControllers = new Map<string, AbortController>();

  private static runKey(projectId: string, runId: string): string {
    return `${projectId}:${runId}`;
  }

  /**
   * 进程重启后恢复：清扫遗留 running / queued 释放项目槽，保留 suspended 待审任务
   */
  public static recoverStaleTasks(): number {
    return TaskStore.getInstance().recoverInterruptedTasks();
  }

  private static enqueueStageExecution(params: {
    projectId: string;
    runId: string;
    runningStage: 'plan_gdd' | 'extract_visual_spec' | 'build_text_game' | 'compile_film';
    initialProgress: { percent: number; current: number; total: number; note: string };
    execute: () => Promise<{ status: 'suspended' | 'succeeded'; result: any }>;
  }): void {
    const { projectId, runId, runningStage, initialProgress, execute } = params;
    const taskStore = TaskStore.getInstance();
    const key = this.runKey(projectId, runId);

    const controller = new AbortController();
    this.activeControllers.set(key, controller);

    const queued = this.laneScheduler.getQueueDepth(projectId) > 0;
    const task = taskStore.getTask(projectId, runId);
    if (task) {
      const prevCompleted = (task.result as any)?.completedSteps;
      task.error = undefined;
      task.result = {
        currentStage: runningStage,
        ...(prevCompleted && typeof prevCompleted === 'object'
          ? { completedSteps: prevCompleted }
          : {}),
      };
      taskStore.saveTask(projectId, task);
    }
    taskStore.setStatus(projectId, runId, queued ? 'queued' : 'running');
    taskStore.updateProgress(projectId, runId, initialProgress);

    void this.laneScheduler
      .enqueue(projectId, async () => {
        const latest = taskStore.getTask(projectId, runId);
        if (!latest || latest.status === 'cancelled' || controller.signal.aborted) {
          return;
        }

        if (latest.status !== 'running') {
          taskStore.setStatus(projectId, runId, 'running');
        }

        await withRunContext(
          {
            projectId,
            runId,
            lane: 'batch',
            abortSignal: controller.signal,
          },
          async () => {
            const outcome = await execute();
            const currentAfter = taskStore.getTask(projectId, runId);
            if (controller.signal.aborted || currentAfter?.status === 'cancelled') {
              return;
            }
            const completedSteps = (currentAfter?.result as any)?.completedSteps;
            const mergedResult =
              completedSteps && typeof completedSteps === 'object'
                ? { ...outcome.result, completedSteps }
                : outcome.result;
            taskStore.setStatus(projectId, runId, outcome.status, {
              result: mergedResult,
            });
          }
        );
      })
      .catch((err: any) => {
        const latest = taskStore.getTask(projectId, runId);
        if (controller.signal.aborted || isAbortError(err) || latest?.status === 'cancelled') {
          if (latest && latest.status !== 'cancelled') {
            taskStore.setStatus(projectId, runId, 'cancelled', {
              error: latest.error || '创作者主动取消任务',
            });
          }
          return;
        }
        // 任何未预料的失败都留一份证据：错误栈 + 失败瞬间的进度，供事后直接定位
        const failureDir = dumpRunFailure(
          {
            projectId,
            runId,
            workflowKey: String((taskStore.getTask(projectId, runId) as any)?.workflowKey || ''),
            stageNote: (taskStore.getTask(projectId, runId) as any)?.progress?.note,
          },
          err
        );
        const baseMessage = err?.message || '流水线执行异常';
        taskStore.setStatus(projectId, runId, 'failed', {
          error: failureDir ? `${baseMessage}\n失败现场：${failureDir}/error.md` : baseMessage,
        });
      })
      .finally(() => {
        if (this.activeControllers.get(key) === controller) {
          this.activeControllers.delete(key);
        }
      });
  }

  /**
   * 启动生产流水线 (进入阶段一推演，完成后自动挂起等待策划案审批；支持传入既有 existingRunId 原地重续)
   */
  public static async start(
    projectId: string,
    userPrompt: string,
    existingRunId?: string
  ): Promise<string> {
    const taskStore = TaskStore.getInstance();

    // 1. 轻量防抖与运行中互斥门禁：如果当前项目已有其他任务在跑或排队，直接阻断
    const runningTask = taskStore.getRunningTask(projectId);
    if (runningTask && runningTask.taskId !== existingRunId) {
      throw new Error(`[409 Conflict] 项目 [${projectId}] 正在全力推演中，请勿重复提交！`);
    }

    // 2. 创建新任务，或复用既有的老 taskId
    const task = existingRunId
      ? taskStore.getTask(projectId, existingRunId)
      : taskStore.createTask(
          projectId,
          'production_pipeline',
          '互动影游全生命周期生产流水线',
          false,
          { userPrompt }
        );
    if (!task) {
      throw new Error(`[WorkflowEngine] 未找到流水线任务: ${existingRunId}`);
    }

    // 3. 挂载至项目执行通道后台运行
    this.enqueueStageExecution({
      projectId,
      runId: task.taskId,
      runningStage: 'plan_gdd',
      initialProgress: {
        percent: 0,
        current: 0,
        total: 100,
        note: '正在初始化全案策划流水线 (plan-gdd)...',
      },
      execute: async () => {
        ProjectStore.getInstance().updateStudioStageTask(projectId, 'planGddTaskId', task.taskId);
        const stepResult = await executePlanGddStep({
          projectId,
          userPrompt,
          taskId: task.taskId,
        });

        const gate = ProjectStore.getInstance().getArtifact<{
          valid: boolean;
          errors?: string[];
        }>(projectId, 'planner_validation');
        const gateNote =
          gate && gate.valid === false
            ? `｜⚠️ 拓扑门禁未通过（${gate.errors?.length ?? 0} 项）：${(gate.errors || []).join('；')}`
            : '｜拓扑门禁通过';

        return {
          status: 'suspended',
          result: {
            currentStage: 'plan_gdd',
            pendingApproval: {
              type: 'gdd_approval',
              title: '互动游戏策划案 (GDD) 待审批',
              description: `策划案《${stepResult.gdd.title}》已推演完成，请创作者审查玩法机制与抉择动线${gateNote}`,
              data: stepResult.gdd,
              validation: gate ? { valid: gate.valid, errors: gate.errors || [] } : undefined,
            },
          },
        };
      },
    });

    return task.taskId;
  }

  /**
   * 定向资产精修 (Stage Modifier: Planner prd.md / story.md 外科手术式 Patch)
   */
  public static async modify(
    projectId: string,
    target: string,
    detail: string
  ): Promise<string> {
    const taskStore = TaskStore.getInstance();

    // 1. 运行中互斥门禁
    const runningTask = taskStore.getRunningTask(projectId);
    if (runningTask) {
      throw new Error(`[409 Conflict] 项目 [${projectId}] 正在全力推演中，请勿重复提交！`);
    }

    // 2. 创建精修任务
    const task = taskStore.createTask(
      projectId,
      'production_pipeline',
      `定向精修策划案：${target}`,
      false,
      { target, detail, modifierType: 'planner' }
    );
    if (!task) {
      throw new Error(`[WorkflowEngine] 创建精修任务失败`);
    }

    // 3. 挂载至项目执行通道异步运行
    this.enqueueStageExecution({
      projectId,
      runId: task.taskId,
      runningStage: 'plan_gdd',
      initialProgress: {
        percent: 0,
        current: 0,
        total: 100,
        note: `正在准备精修：${target}...`,
      },
      execute: async () => {
        const { runPlannerModify } = await import('../agents/planner/modifier/planner-modifier.js');
        const reporter = (note: string) => {
          taskStore.updateProgress(projectId, task.taskId, {
            percent: 50,
            current: 50,
            total: 100,
            note,
          });
        };

        const modifyResult = await runPlannerModify({
          projectId,
          target,
          detail,
          onProgress: reporter,
        });

        const store = ProjectStore.getInstance();
        const gdd = store.getArtifact(projectId, 'gdd');

        return {
          status: 'suspended',
          result: {
            currentStage: 'plan_gdd',
            modifyResult,
            pendingApproval: {
              type: 'gdd_approval',
              title: `策划案精修完成：${target}`,
              description: `已成功完成定向 Patch 替换（应用 ${modifyResult.appliedPatches}/${modifyResult.totalPatches} 处），请创作者复查。`,
              data: gdd,
            },
          },
        };
      },
    });

    return task.taskId;
  }

  /**
   * 人在回路信号注入 / 中断任务恢复 (中断任务复用既有 taskId 重走流水线，Step 内自判已完成跳过)
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

    const activeOther = taskStore.getRunningTask(projectId);
    if (activeOther && activeOther.taskId !== runId) {
      throw new Error(`[409 Conflict] 项目 [${projectId}] 当前另有运行中任务 [${activeOther.taskId}]，请等待其完成或取消`);
    }

    const isInterrupted = task.status === 'cancelled' || task.status === 'failed';
    if (!isInterrupted && task.status !== 'suspended') {
      throw new Error(`[WorkflowEngine] 当前任务未处于可恢复或可审批状态 (当前状态: ${task.status})`);
    }

    if (!signal.approved) {
      if (task.status !== 'suspended') {
        throw new Error(`[WorkflowEngine] 当前任务状态 (${task.status}) 不支持审批驳回`);
      }
      taskStore.setStatus(projectId, runId, 'failed', {
        error: `创作者已驳回当前工序: ${signal.feedback || '未提供具体原因'}`,
      });
      return this.getState(projectId, runId);
    }

    const stageMetadata = task.result as any;
    const interruptedStage = stageMetadata?.currentStage;
    const currentPending = stageMetadata?.pendingApproval?.type;

    if (isInterrupted && (!interruptedStage || interruptedStage === 'plan_gdd')) {
      const storedPrompt =
        typeof task.payload?.userPrompt === 'string' ? task.payload.userPrompt.trim() : '';
      if (!storedPrompt) {
        throw new Error(`[WorkflowEngine] 任务 [${runId}] 缺少原始立项 userPrompt，无法恢复阶段一推演`);
      }
      await this.start(projectId, storedPrompt, runId);
      return this.getState(projectId, runId);
    }

    const store = ProjectStore.getInstance();

    // 阶段二：影视生成前序工序（Step 1 资产提取 + Step 2 分镜台本规划，纯文字 LLM 推演，零出图出视频算力）
    if (
      currentPending === 'gdd_approval' ||
      (isInterrupted && interruptedStage === 'extract_visual_spec')
    ) {
      this.enqueueStageExecution({
        projectId,
        runId,
        runningStage: 'extract_visual_spec',
        initialProgress: {
          percent: 0,
          current: 0,
          total: 100,
          note: '视频 Agent Step 1：正在提炼全剧实物与场景特征（纯文本提取，不消耗生图算力）...',
        },
        execute: async () => {
          const gdd = store.getArtifact<any>(projectId, 'gdd');
          const plannerPrd = store.getArtifact<any>(projectId, 'planner_prd');
          const prd = plannerPrd?.prd || gdd?.prd;
          const title = gdd?.title || prd?.gameTitle || store.getProject(projectId).meta.title;
          const storyMarkdown = gdd?.storyMarkdown || '';

          if (!prd) {
            throw new Error(`[WorkflowEngine] 项目 [${projectId}] 缺少策划案 PRD，无法启动视听前序规划`);
          }

          // 1. Step 1: 视觉资产提取 (纯文字 LLM)
          store.updateStudioStageTask(projectId, 'assetExtractionTaskId', runId);
          taskStore.updateProgress(projectId, runId, {
            percent: 25,
            current: 25,
            total: 100,
            note: '影视生产 Step 1：正在提炼角色、实物道具与场景外观设定 (纯文字提取)...',
          });
          const { entities } = await executeAssetExtractionStep({
            projectId,
            title,
            prd,
            storyMarkdown,
          });

          // 2. Step 2: 分镜台本规划 (纯文字 LLM，各幕分镜切片与镜头台本拆解)
          store.updateStudioStageTask(projectId, 'storyboardPlanningTaskId', runId);
          taskStore.updateProgress(projectId, runId, {
            percent: 65,
            current: 65,
            total: 100,
            note: '影视生产 Step 2：正在依据剧本与视觉资产规划全剧分镜台本 (纯文字拆解)...',
          });
          const filmSpec = await executeStoryboardPlanningStep({
            projectId,
            title,
            prd,
            storyMarkdown,
            entities,
          });

          const charNames = entities.characters.map((c) => c.name).join('、') || '主角';
          const itemNames = entities.items.map((i) => i.name).join('、') || '暂无专属道具';
          const locNames = entities.locations.map((l) => l.name).join('、') || '核心场景';
          const totalShots = filmSpec.clips.reduce((sum, c) => sum + (c.shots?.length || 0), 0);

          const summaryText = `已成功完成视听前序规划：提炼出 ${entities.characters.length} 位角色（${charNames}）、${entities.items.length} 件实物道具（${itemNames}）、${entities.locations.length} 处场景（${locNames}），并规划出 ${filmSpec.clips.length} 幕共 ${totalShots} 个分镜镜头。视频制作工坊已就绪，可进入工坊检视分镜台本与定妆卡片。`;

          // 将提取与规划成果推送到聊天消息中
          store.appendChatRecord(projectId, {
            role: 'assistant',
            content: `🎯 **全剧视听设定提取与分镜台本规划已完成（纯文字推演 · 零物理算力）**\n\n` +
              `- 🎭 **登场角色 (${entities.characters.length})**：${charNames}\n` +
              `- 📦 **实物与道具 (${entities.items.length})**：${itemNames}\n` +
              `- 🏞️ **核心场景 (${entities.locations.length})**：${locNames}\n` +
              `- 🎬 **全剧分镜台本**：${filmSpec.clips.length} 幕，共 ${totalShots} 个分镜镜头\n\n` +
              `> 💡 *Step 1 与 Step 2 均为纯文本结构化视听推演，未消耗生图与视频物理算力。下方已生成视频工坊入口，点击即可进入【视频工坊】查看定妆卡片与各幕分镜台本。*`,
            taskRunId: runId,
            taskStage: 'extract_visual_spec',
          });

          return {
            status: 'suspended',
            result: {
              currentStage: 'extract_visual_spec',
              entities,
              filmSpec,
              pendingApproval: {
                type: 'lookdev_approval',
                title: '视频工坊 · 待制作',
                description: summaryText,
                data: { entities, filmSpec },
              },
            },
          };
        },
      });

      return this.getState(projectId, runId);
    }

    // 阶段二续跑：执行视频制作工坊总流水线 (studio-master: lookdev 定妆 ➔ cinema-act 各幕分镜视频)
    if (
      currentPending === 'lookdev_approval' ||
      (isInterrupted && (interruptedStage === 'build_text_game' || interruptedStage === 'compile_film'))
    ) {
      this.enqueueStageExecution({
        projectId,
        runId,
        runningStage: 'compile_film',
        initialProgress: {
          percent: 0,
          current: 0,
          total: 100,
          note: '视频工坊 (studio-master)：正在启动定妆 (lookdev) 与各幕分镜视频 (cinema-act)...',
        },
        execute: async () => {
          const reporter = (note: string, percent: number) => {
            taskStore.updateProgress(projectId, runId, {
              percent,
              current: percent,
              total: 100,
              note,
            });
          };

          // 1. 运行视频制作工坊总流水线 (03-video-studio)
          store.updateStudioStageTask(projectId, 'studioMasterTaskId', runId);
          await executeStudioMasterWorkflow({
            projectId,
            onProgress: reporter,
          });

          // 2. 组装互动播放器
          reporter('全幕分镜视频已就绪，正在装配互动影游 (game-assembly)...', 95);
          const stepResult = await executeBuildGameAssemblyStep({
            projectId,
            taskId: runId,
          });

          return {
            status: 'succeeded',
            result: {
              currentStage: 'completed',
              textGame: stepResult.textGame,
            },
          };
        },
      });

      return this.getState(projectId, runId);
    }

    if (currentPending === 'playtest_approval' || (isInterrupted && interruptedStage === 'compile_film')) {
      this.enqueueStageExecution({
        projectId,
        runId,
        runningStage: 'compile_film',
        initialProgress: {
          percent: 0,
          current: 0,
          total: 100,
          note: '正在启动影游视听切片编译 (compile-film)...',
        },
        execute: async () => {
          const stepResult = await executeCompileFilmStep({
            projectId,
            taskId: runId,
          });

          return {
            status: 'succeeded',
            result: {
              currentStage: 'completed',
              filmSpec: stepResult.filmSpec,
            },
          };
        },
      });

      return this.getState(projectId, runId);
    }

    throw new Error(`[WorkflowEngine] 当前任务缺少可推进的审批上下文 (runId: ${runId})`);
  }

  /**
   * 主动取消正在运行或排队中的工作流，并通过 AbortSignal 中止在途 LLM / ComfyUI 请求
   */
  public static cancel(
    projectId: string,
    runId: string,
    reason: string = '创作者主动取消任务'
  ): WorkflowRunStateSnapshot {
    const taskStore = TaskStore.getInstance();
    const task = taskStore.getTask(projectId, runId);
    if (!task) {
      throw new Error(`[WorkflowEngine] 未找到流水线任务: ${runId}`);
    }

    if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
      return this.getState(projectId, runId);
    }

    const key = this.runKey(projectId, runId);
    const controller = this.activeControllers.get(key);
    if (controller && !controller.signal.aborted) {
      controller.abort(new RunAbortedError(reason));
    }

    taskStore.setStatus(projectId, runId, 'cancelled', { error: reason });
    return this.getState(projectId, runId);
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
    if (task.status === 'queued') status = 'queued';
    else if (task.status === 'proposed' || task.status === 'suspended') status = 'suspended';
    else if (task.status === 'succeeded') status = 'succeeded';
    else if (task.status === 'cancelled') status = 'cancelled';
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
