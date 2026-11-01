/**
 * agent-runtime/workflow/StageExecutor.ts
 * 通用工作流工序执行机 (Stage Execution Engine SSOT)
 *
 * 核心机制：
 * 1. 控制反转 (IoC)：接收外部注入的流水线工厂字典与自愈医生 (Doctor Agent)；
 * 2. 单阶段流水线生命周期管理 (Progress 毫秒广播 ➔ Pipeline 执行 ➔ Doctor 异常切面自愈 ➔ 产物双向落盘)；
 * 3. 宏观步骤蓝图解释机 (解释 STAGE, PARALLEL, SEQUENCE 并管理工程状态流转)。
 */

import { ProjectStore } from '../../project-store/index.js';
import { ProgressBus, JobAbortRegistry } from '../bus/index.js';
import { WorkflowStage, SessionStatus, type WorkflowSession } from '../../types/index.js';
import type {
  StageBlueprint,
  StageExecutorConfig,
} from './types.js';

export class StageExecutor {
  constructor(private readonly config: StageExecutorConfig) {}

  /**
   * 执行单个独立工序阶段 (直接调度目标声明式 Pipeline，集成 Doctor 自愈与状态黑板落盘)
   */
  public async executeSingleStage(
    projectId: string,
    stage: WorkflowStage,
    userFeedback?: string,
    manageSessionStatus: boolean = true,
    extraOptions?: Record<string, any>
  ): Promise<WorkflowSession> {
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found in ProjectStore`);

    const pipelineFactory = this.config.pipelineRegistry[stage];
    if (!pipelineFactory) {
      throw new Error(`阶段 [${stage}] 未注册对应的生产流水线`);
    }

    if (manageSessionStatus) {
      project.status = SessionStatus.RUNNING;
      project.currentStage = stage;
      project.updatedAt = new Date().toISOString();
      store.saveProject(project);
    }

    ProgressBus.getInstance().emitProgress({
      projectId,
      stage,
      percent: 15,
      detail: `启动阶段生产流水线: [${stage}]`,
      timestamp: new Date().toISOString(),
    });

    const pipelineInput = {
      projectId,
      idea: project.meta.idea,
      style: project.meta.style,
      videoRatio: project.meta.videoRatio || '16:9',
      videoResolution: project.meta.videoResolution || '720P',
      episodes: project.meta.episodes || 1,
      userFeedback,
      ...(extraOptions || {}),
      abortSignal: extraOptions?.abortSignal || JobAbortRegistry.get(projectId)?.signal,
    };

    let result: any;
    const pipeline = pipelineFactory(projectId);

    try {
      result = await pipeline.execute(pipelineInput);
    } catch (err: any) {
      if (this.config.healer) {
        console.warn(`[StageExecutor] 阶段 [${stage}] 执行异常，唤醒自愈机制: ${err.message}`);
        try {
          const failureContext = `阶段: ${stage}\n风格: ${project.meta.style}\n画幅: ${project.meta.videoRatio || '16:9'}\n${err.stack || ''}`;
          const originalPrompt = typeof userFeedback === 'string' && userFeedback.trim()
            ? userFeedback
            : `阶段 [${stage}] 生成任务: ${project.meta.idea}`;

          const diagnosis = await this.config.healer.diagnose({
            projectId,
            stage,
            model: 'llm-service',
            error: err.message || 'Pipeline execution failed',
            originalPrompt,
            context: failureContext,
            validationError: err.message,
          });

          if (diagnosis.should_retry && diagnosis.rewrittenPrompt) {
            console.log(`[StageExecutor] 🩺 Doctor 提出提示词自愈重试建议: ${diagnosis.rewrittenPrompt}`);
            ProgressBus.getInstance().emitProgress({
              projectId,
              stage,
              percent: 30,
              detail: `自愈机制介入重试: ${diagnosis.reason_type || 'prompt_refine'}`,
              timestamp: new Date().toISOString(),
            });

            result = await pipeline.execute({
              ...pipelineInput,
              userFeedback: diagnosis.rewrittenPrompt,
            });
          } else {
            if (manageSessionStatus) {
              project.status = SessionStatus.FAILED;
              project.updatedAt = new Date().toISOString();
              store.saveProject(project);
            }
            throw err;
          }
        } catch {
          if (manageSessionStatus) {
            project.status = SessionStatus.FAILED;
            project.updatedAt = new Date().toISOString();
            store.saveProject(project);
          }
          throw err;
        }
      } else {
        if (manageSessionStatus) {
          project.status = SessionStatus.FAILED;
          project.updatedAt = new Date().toISOString();
          store.saveProject(project);
        }
        throw err;
      }
    }

    if (!result?.success) {
      if (manageSessionStatus) {
        project.status = SessionStatus.FAILED;
        project.updatedAt = new Date().toISOString();
        store.saveProject(project);
      }
      throw new Error(result?.summary || `阶段 [${stage}] 执行失败`);
    }

    const latestProject = store.getProject(projectId) || project;
    if (!latestProject.stageArtifacts) latestProject.stageArtifacts = {};
    latestProject.stageArtifacts[stage] = result.data;
    if (!latestProject.history) latestProject.history = [];
    latestProject.history.push({
      timestamp: new Date().toISOString(),
      stage,
      action: 'STAGE_COMPLETED',
      details: result.summary,
    });
    if (manageSessionStatus) {
      latestProject.status = SessionStatus.IDLE;
    }
    latestProject.updatedAt = new Date().toISOString();
    store.saveProject(latestProject);

    ProgressBus.getInstance().emitProgress({
      projectId,
      stage,
      percent: 100,
      detail: `阶段 [${stage}] 生产完成`,
      timestamp: new Date().toISOString(),
    });

    return latestProject;
  }

  /**
   * 执行指定的宏观阶段编排蓝图（支持 STAGE, PARALLEL, SEQUENCE）
   */
  public async executeStageBlueprint(
    projectId: string,
    blueprint: StageBlueprint,
    userFeedback?: string,
    extraOptions?: Record<string, any>
  ): Promise<WorkflowSession> {
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found in ProjectStore`);

    project.status = SessionStatus.RUNNING;
    project.updatedAt = new Date().toISOString();
    store.saveProject(project);

    try {
      if (blueprint.type === 'STAGE') {
        project.currentStage = blueprint.stage;
        store.saveProject(project);
        await this.executeSingleStage(projectId, blueprint.stage, userFeedback, false, extraOptions);
      } else if (blueprint.type === 'PARALLEL') {
        const checkProject = store.getProject(projectId) || project;
        // 🌟 核心机制：对齐 SEQUENCE 幂等性，已有资产且无修改指令的子阶段自动复用跳过，杜绝时光倒流覆盖
        const activeStages = blueprint.stages.filter((st) => {
          return !checkProject.stageArtifacts?.[st.stage] || !!userFeedback;
        });

        if (activeStages.length > 0) {
          project.currentStage = activeStages[0].stage;
          store.saveProject(project);

          // 🌟 故障快速隔离与 Abort 传播：创建局部 AbortController，任一子阶段失败立即广播中止兄弟阶段
          const parallelAbort = new AbortController();
          const baseSignal = extraOptions?.abortSignal || JobAbortRegistry.get(projectId)?.signal;
          if (baseSignal) {
            baseSignal.addEventListener('abort', () => parallelAbort.abort(), { once: true });
          }

          try {
            await Promise.all(
              activeStages.map(async (st) => {
                try {
                  await this.executeSingleStage(projectId, st.stage, userFeedback, false, {
                    ...extraOptions,
                    abortSignal: parallelAbort.signal,
                  });
                } catch (stageErr) {
                  parallelAbort.abort();
                  throw stageErr;
                }
              })
            );
          } catch (parallelErr) {
            parallelAbort.abort();
            throw parallelErr;
          }
        }
      } else if (blueprint.type === 'SEQUENCE') {
        for (const st of blueprint.stages) {
          const checkProject = store.getProject(projectId) || project;
          // 🌟 核心机制：若该子工序已有完整交付物且无显式重修要求，自动复用跳过，杜绝重复覆盖
          if (checkProject.stageArtifacts?.[st.stage] && !userFeedback) {
            continue;
          }
          project.currentStage = st.stage;
          store.saveProject(project);
          await this.executeSingleStage(projectId, st.stage, userFeedback, false, extraOptions);
        }
      }

      const updated = store.getProject(projectId)!;
      updated.status = SessionStatus.IDLE;
      updated.updatedAt = new Date().toISOString();
      store.saveProject(updated);
      return updated;
    } catch (err: any) {
      const failed = store.getProject(projectId)!;
      failed.status = SessionStatus.FAILED;
      failed.updatedAt = new Date().toISOString();
      store.saveProject(failed);
      throw err;
    }
  }
}
