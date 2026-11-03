/**
 * mastra/workflows/workflow-manager.ts
 * Mastra 原生工作流调度与人在回路挂起/恢复管理器 (Workflow Manager SSOT)
 * 
 * 职责：
 * 1. 替代手搓的 ProposalStore 与 ProposalExecutor；
 * 2. 调度 pipelineWorkflow.createRun() 与 run.start() / run.resume()；
 * 3. 刚性门禁前置校验，集成 ProjectLockManager 杜绝并发重复扣费；
 * 4. 统一持久化活动 Run 状态至磁盘 SSOT。
 */

import { pipelineWorkflow } from './pipeline.workflow.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { ProjectLockManager } from '../../utils/projectLock.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';

export interface WorkflowRunStatus {
  runId: string;
  projectId: string;
  status: 'running' | 'suspended' | 'success' | 'failed';
  currentStepId?: string;
  suspendedReason?: string;
  suspendedPayload?: any;
  updatedAt: string;
}

export class WorkflowManager {
  private static instance?: WorkflowManager;
  // 维护活跃 Run 实例与快照缓存
  private activeRuns: Map<string, { run: any; status: WorkflowRunStatus }> = new Map();

  public static getInstance(): WorkflowManager {
    if (!WorkflowManager.instance) {
      WorkflowManager.instance = new WorkflowManager();
    }
    return WorkflowManager.instance;
  }

  /**
   * 启动指定项目的工作流推进
   */
  public async startWorkflow(projectId: string, feedback?: string): Promise<WorkflowRunStatus> {
    const lock = ProjectLockManager.getInstance();

    return await lock.withLock(projectId, async () => {
      return await this.startWorkflowInternal(projectId, feedback);
    });
  }

  /**
   * 启动工作流核心内部逻辑（无锁版，避免内部调用时非重入死锁）
   */
  private async startWorkflowInternal(projectId: string, feedback?: string): Promise<WorkflowRunStatus> {
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) {
      throw new Error(`[WorkflowManager] 项目不存在: ${projectId}`);
    }

    // 检查当前阶段门禁
    const currentStage = project.currentStage;
    const stageGate = store.getArtifact<any>(projectId, `critic_review_${currentStage}`);
    if (stageGate?.gateStatus === 'FAIL') {
      throw new Error(`[WorkflowManager] 当前阶段 ${currentStage} 审查未通过 (FAIL)，禁止向下推进！请先针对瑕疵优化自愈。`);
    }

    const run = await pipelineWorkflow.createRun();
    const runId = run.runId;

    console.log(`[WorkflowManager] 启动 Mastra Pipeline Workflow Run: ${runId} (项目: ${projectId})`);

    const statusObj: WorkflowRunStatus = {
      runId,
      projectId,
      status: 'running',
      updatedAt: new Date().toISOString(),
    };
    this.activeRuns.set(projectId, { run, status: statusObj });

    try {
      const result = await run.start({
        inputData: {
          projectId,
          activeStage: currentStage,
          feedback,
        },
      });

      if (result.status === 'suspended') {
        const suspendedStep = (result as any).suspendedStep || 'unknown-step';
        statusObj.status = 'suspended';
        statusObj.currentStepId = suspendedStep;
        statusObj.suspendedPayload = (result as any).suspendPayload;
        statusObj.suspendedReason = (result as any).suspendPayload?.summary || '等待创作者确认授权';
        statusObj.updatedAt = new Date().toISOString();

        console.log(`[WorkflowManager] 工作流在步骤 [${suspendedStep}] 挂起，等待人在回路裁决`);
      } else if (result.status === 'success') {
        statusObj.status = 'success';
        statusObj.updatedAt = new Date().toISOString();
      } else {
        statusObj.status = 'failed';
        statusObj.updatedAt = new Date().toISOString();
      }

      return statusObj;
    } catch (err: any) {
      statusObj.status = 'failed';
      statusObj.updatedAt = new Date().toISOString();
      throw err;
    }
  }

  /**
   * 创作者批准并恢复挂起的工作流 (Resume Suspended Workflow)
   */
  public async resumeWorkflow(projectId: string, stepId?: string, overrideData?: any): Promise<WorkflowRunStatus> {
    const lock = ProjectLockManager.getInstance();

    return await lock.withLock(projectId, async () => {
      const active = this.activeRuns.get(projectId);
      if (!active) {
        // 如果没有内存活动 Run，无锁调用内部启动方法，避免非重入死锁
        return await this.startWorkflowInternal(projectId, overrideData?.feedback);
      }

      const { run, status } = active;
      if (status.status !== 'suspended') {
        throw new Error(`[WorkflowManager] 当前工作流未处于挂起状态 (当前: ${status.status})，无法 resume！`);
      }

      const targetStep = stepId || status.currentStepId;
      console.log(`[WorkflowManager] 恢复执行挂起的工作流: runId=${status.runId}, step=${targetStep}`);

      try {
        const result = await run.resume({
          step: targetStep,
          resumeData: {
            projectId,
            approved: true,
            overrideParams: overrideData,
          },
        });

        if (result.status === 'suspended') {
          status.status = 'suspended';
          status.currentStepId = (result as any).suspendedStep;
          status.suspendedPayload = (result as any).suspendPayload;
          status.updatedAt = new Date().toISOString();
        } else if (result.status === 'success') {
          status.status = 'success';
          status.updatedAt = new Date().toISOString();
        } else {
          status.status = 'failed';
          status.updatedAt = new Date().toISOString();
        }

        return status;
      } catch (err: any) {
        status.status = 'failed';
        status.updatedAt = new Date().toISOString();
        throw err;
      }
    });
  }

  /**
   * 获取项目当前活跃 Run 状态
   */
  public getStatus(projectId: string): WorkflowRunStatus | undefined {
    return this.activeRuns.get(projectId)?.status;
  }
}
