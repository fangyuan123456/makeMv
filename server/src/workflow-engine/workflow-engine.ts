/**
 * workflow-engine/workflow-engine.ts
 * 通用微内核工作流调度与生命周期执行引擎 (Universal Workflow Engine SSOT)
 * 
 * 核心架构特性（彻底通用化与控制反转 IoC）：
 * 1. 零领域逆向依赖：底座绝不 import 具体的业务流水线（不硬编码总导演、编剧或特定影视工序）；
 * 2. 动态注册中心 (Registry)：业务模块通过 registerWorkflow 动态挂载工作流、元数据与门禁/状态机钩子；
 * 3. 统一 AOP 拦截：统一判定是否需要创作者审批，支持免确认全自动与严格审核；
 * 4. 刚性安全防线：串行互斥锁 (ProjectLockManager)、防双击防重放、孤儿自愈与严格状态机流转。
 */

import { randomUUID } from 'crypto';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { ProposalStore } from '../project-store/ProposalStore.js';
import { ProjectLockManager } from '../utils/projectLock.js';
import { config } from '../utils/config.js';
import type { ActionProposal } from '../types/index.js';
import type {
  WorkflowRegistration,
  DispatchWorkflowOptions,
  DispatchWorkflowResult,
  ExecuteProposalOptions,
  ExecuteProposalResult,
  StartProposalResult,
  WorkflowHookContext,
} from './types.js';

export class WorkflowEngine {
  private static instance?: WorkflowEngine;
  private registrations = new Map<string, WorkflowRegistration>();
  private activeTasks = new Map<string, Promise<ExecuteProposalResult>>();

  public static getInstance(): WorkflowEngine {
    if (!WorkflowEngine.instance) {
      WorkflowEngine.instance = new WorkflowEngine();
    }
    return WorkflowEngine.instance;
  }

  /**
   * 动态注册工作流定义 (IoC 单一入口)
   */
  public registerWorkflow(registration: WorkflowRegistration): void {
    this.registrations.set(registration.key, registration);
  }

  /**
   * 获取已注册的工序执行器 (Mastra Step 或 Handler)
   */
  public getHandler(key: string): any {
    return this.registrations.get(key)?.execute;
  }

  /**
   * 获取已注册的工作流完整元数据
   */
  public getRegistration(key: string): WorkflowRegistration | undefined {
    return this.registrations.get(key);
  }

  /**
   * 判断任意工作流是否需要人在回路审批 (通用切面判定)
   */
  public isConfirmationRequired(workflowKey: string, explicitOverride?: boolean): boolean {
    if (explicitOverride !== undefined) {
      return explicitOverride;
    }
    const setting = config.workflow?.requireConfirmation;
    if (setting === true) return true;
    if (setting === false || setting === undefined) return false;
    if (Array.isArray(setting)) return setting.includes(workflowKey);
    return false;
  }

  /**
   * 统一业务派发入口：
   * 业务模块或 Agent 调度工作流，底层透明处理确认拦截与提案生成
   */
  public async dispatch(options: DispatchWorkflowOptions): Promise<DispatchWorkflowResult> {
    const {
      projectId,
      sessionId,
      workflowKey,
      actionType = 'PROCEED_STAGE',
      title,
      reason,
      userPrompt,
      parameters,
      requireConfirmation,
    } = options;

    const projectStore = ProjectStore.getInstance();
    const proposalStore = ProposalStore.getInstance();

    const project = projectStore.getProject(projectId);
    if (!project) {
      throw new Error(`[WorkflowEngine] 未找到项目: ${projectId}`);
    }

    const reg = this.registrations.get(workflowKey);
    const targetStage = reg?.legalStage || (project as any).currentStage;
    const existingProposals = proposalStore.listProposals(projectId);

    // 提案幂等性防御：检查同 session、同 skill、同 stage 是否已有 pending 状态提案
    const duplicateProposal = existingProposals.find(
      (p) =>
        p.status === 'pending' &&
        p.skill === workflowKey &&
        p.payload?.stage === targetStage &&
        (!sessionId || p.sessionId === sessionId)
    );

    if (duplicateProposal) {
      return {
        success: true,
        proposalId: duplicateProposal.actionId,
        proposal: duplicateProposal,
        summary: `已复用待确认提案: [${duplicateProposal.label}]`,
        isReused: true,
      };
    }

    const actionId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const displayTitle = title || reg?.title || `执行工序 [${workflowKey}]`;
    const newProposal: ActionProposal = {
      actionId,
      actionType,
      projectId,
      skill: workflowKey,
      label: displayTitle,
      description: reason,
      status: 'pending',
      sessionId,
      createdAt: new Date().toISOString(),
      payload: {
        ...(parameters || {}),
        userPrompt,
        stage: targetStage,
        actionType,
      },
    };

    proposalStore.saveProposal(projectId, newProposal);

    // 切面拦截判定：是否需要停下等待创作者确认
    const needsConfirm = this.isConfirmationRequired(workflowKey, requireConfirmation);

    if (needsConfirm) {
      return {
        success: true,
        proposalId: actionId,
        proposal: newProposal,
        summary: `已生成待审核提案: [${displayTitle}]，等待创作者裁决授权`,
        isReused: false,
        autoStarted: false,
      };
    }

    // 全自动放行：直接启动后台异步执行
    await this.startProposal({
      projectId,
      proposalId: actionId,
    });

    const refreshed = proposalStore.getProposal(projectId, actionId) || newProposal;
    return {
      success: true,
      proposalId: actionId,
      proposal: refreshed,
      summary: `工序 [${displayTitle}] 无需拦截，已自动启动后台执行`,
      isReused: false,
      autoStarted: true,
    };
  }

  /**
   * 启动提案执行（毫秒级同步校验并置为 running，后台异步任务化）
   */
  public async startProposal(options: ExecuteProposalOptions): Promise<StartProposalResult> {
    const { projectId, proposalId, overrideParameters } = options;
    const proposalStore = ProposalStore.getInstance();
    const lock = ProjectLockManager.getInstance();

    // 0. 内存防重放：若该提案已在后台任务中，直接幂等返回
    if (this.activeTasks.has(proposalId)) {
      const current = proposalStore.getProposal(projectId, proposalId);
      return {
        accepted: true,
        proposal: current || ({} as any),
      };
    }

    const runningProposal = await lock.withLock(projectId, async () => {
      if (this.activeTasks.has(proposalId)) {
        return proposalStore.getProposal(projectId, proposalId) || ({} as any);
      }

      const proposal = proposalStore.getProposal(projectId, proposalId);
      if (!proposal) {
        throw new Error(`[WorkflowEngine] 未找到提案: ${proposalId}`);
      }

      if (proposal.status !== 'pending') {
        throw new Error(`[WorkflowEngine] 提案处于非可执行状态 [${proposal.status}]，禁止执行！`);
      }

      const workflowKey = proposal.skill;
      if (!workflowKey) {
        throw new Error(`[WorkflowEngine] 提案 [${proposalId}] 缺少合法的 workflowKey/skill 标识`);
      }

      const reg = this.registrations.get(workflowKey);
      if (!reg || !reg.execute) {
        throw new Error(`[WorkflowEngine] 未找到已注册的工序执行器: ${workflowKey}`);
      }

      // 动态门禁校验钩子 (IoC 门禁守卫)
      if (reg.validateGate) {
        const gateResult = reg.validateGate({
          projectId,
          sessionId: proposal.sessionId,
          proposalId,
          actionType: proposal.actionType,
          payload: proposal.payload || {},
        });
        if (!gateResult.pass) {
          throw new Error(`[WorkflowEngine] 门禁拦截: ${gateResult.reason || '工序未通过前置门禁质检'}`);
        }
      }

      // 翻转状态为 running 并落盘
      return proposalStore.updateProposalStatus(projectId, proposalId, 'running', {
        startedAt: new Date().toISOString(),
        lastMessage: `工序 [${workflowKey}] 已启动，正在执行中...`,
      });
    });

    const reg = runningProposal.skill ? this.registrations.get(runningProposal.skill) : undefined;
    // 启动后台异步任务 (fire-and-forget)，此时外层状态机锁已安全释放
    const taskPromise = this.runProposalTask(projectId, proposalId, reg, overrideParameters);
    this.activeTasks.set(proposalId, taskPromise);
    taskPromise.finally(() => {
      this.activeTasks.delete(proposalId);
    });

    return {
      accepted: true,
      proposal: runningProposal,
    };
  }

  /**
   * 后台异步执行任务内核
   */
  private async runProposalTask(
    projectId: string,
    proposalId: string,
    reg?: WorkflowRegistration,
    overrideParameters?: Record<string, any>
  ): Promise<ExecuteProposalResult> {
    const lock = ProjectLockManager.getInstance();
    const proposalStore = ProposalStore.getInstance();
    const projectStore = ProjectStore.getInstance();
    const proposal = proposalStore.getProposal(projectId, proposalId)!;

    return await lock.withLock(projectId, async () => {
      // 锁内双重核验 (Double-Checked Locking)
      const refreshedProposal = proposalStore.getProposal(projectId, proposalId);
      if (!refreshedProposal || refreshedProposal.status !== 'running') {
        const currentStatus = refreshedProposal?.status || 'unknown';
        console.warn(`[WorkflowEngine] 提案 [${proposalId}] 状态已变更为 [${currentStatus}]，放弃后台工作流执行`);
        return {
          success: currentStatus === 'executed',
          proposal: refreshedProposal || proposal,
          result: { summary: refreshedProposal?.resultSummary || `提案当前处于 ${currentStatus} 状态` },
        };
      }

      const project = projectStore.getProject(projectId);
      const cleanPayload = { ...(proposal.payload || {}) };

      const targetReg = reg || (proposal.skill ? this.registrations.get(proposal.skill) : undefined);
      if (!targetReg || !targetReg.execute) {
        throw new Error(`[WorkflowEngine] 未找到提案 [${proposalId}] 对应的工序执行器注册实例`);
      }

      try {
        console.log(`[WorkflowEngine] 后台开始执行工序: key=${targetReg.key}, project=${projectId}`);
        const inputData = {
          projectId,
          sessionId: proposal.sessionId,
          activeStage: (project as any)?.currentStage,
          payload: { ...cleanPayload, proposalId },
          overrideParams: overrideParameters,
        };

        const executeFn =
          typeof targetReg.execute === 'function'
            ? targetReg.execute
            : (targetReg.execute as any).execute.bind(targetReg.execute);

        const stepOutput = await executeFn({ inputData });
        const toolResult = stepOutput?.toolResult;

        if (toolResult?.error || toolResult?.success === false) {
          const errorMsg = toolResult?.message || toolResult?.error || '工序工具返回执行失败';
          proposalStore.updateProposalStatus(projectId, proposalId, 'failed', {
            failedAt: new Date().toISOString(),
            error: errorMsg,
          });
          return { success: false, proposal, error: errorMsg, result: toolResult };
        }

        // 执行业务层注入的成功回调与状态机推进钩子 (IoC Hook)
        const hookCtx: WorkflowHookContext = {
          projectId,
          sessionId: proposal.sessionId,
          proposalId,
          actionType: proposal.actionType,
          payload: cleanPayload,
          result: toolResult || stepOutput,
        };

        if (targetReg.onSuccess) {
          await targetReg.onSuccess(hookCtx);
        } else if (targetReg.nextStage && project && (project as any).currentStage) {
          // 默认推进规则
          (project as any).currentStage = targetReg.nextStage;
          project.updatedAt = new Date().toISOString();
          projectStore.saveProject(project);
          console.log(`[WorkflowEngine] 项目 [${projectId}] 自动推进至业务阶段: ${targetReg.nextStage}`);
        }

        const summary = stepOutput.lastSummary || toolResult?.summary || '工序执行完成';
        const updatedProposal = proposalStore.updateProposalStatus(projectId, proposalId, 'executed', {
          executedAt: new Date().toISOString(),
          resultSummary: summary,
        });

        return {
          success: true,
          proposal: updatedProposal || proposal,
          result: toolResult || stepOutput,
        };
      } catch (err: any) {
        const latestProposal = proposalStore.getProposal(projectId, proposalId);
        if (latestProposal && latestProposal.status === 'running') {
          proposalStore.updateProposalStatus(projectId, proposalId, 'failed', {
            failedAt: new Date().toISOString(),
            error: err.message || '执行异常',
          });
        }
        return {
          success: false,
          proposal: latestProposal || proposal,
          error: err.message,
        };
      }
    });
  }

  /**
   * 同步执行提案（供自动化测试或同步调用端使用）
   */
  public async executeProposal(options: ExecuteProposalOptions): Promise<ExecuteProposalResult> {
    const { proposalId } = options;
    await this.startProposal(options);
    const runningTask = this.activeTasks.get(proposalId);
    if (runningTask) {
      return await runningTask;
    }
    const proposalStore = ProposalStore.getInstance();
    const current = proposalStore.getProposal(options.projectId, proposalId)!;
    return {
      success: current.status === 'executed',
      proposal: current,
      error: current.error,
    };
  }

  /**
   * 底层工序任务直接执行入口 (提供单元测试与底层自愈直通能力)
   */
  public async runProposal(
    projectId: string,
    proposalId: string,
    workflowKey?: string,
    parameters?: Record<string, any>
  ): Promise<ExecuteProposalResult> {
    const reg = workflowKey ? this.registrations.get(workflowKey) : undefined;
    return this.runProposalTask(projectId, proposalId, reg, parameters);
  }

  /**
   * 创作者驳回提案
   */
  public async rejectProposal(projectId: string, proposalId: string, reason?: string): Promise<ActionProposal> {
    const lock = ProjectLockManager.getInstance();
    return lock.withLock(projectId, async () => {
      const proposalStore = ProposalStore.getInstance();
      const current = proposalStore.getProposal(projectId, proposalId);
      if (!current) {
        throw new Error(`[WorkflowEngine] 提案 ${proposalId} 不存在`);
      }
      if (current.status === 'running' || this.activeTasks.has(proposalId)) {
        const err = new Error(`提案 ${proposalId} 正在执行中，不可驳回`);
        (err as any).statusCode = 409;
        throw err;
      }
      if (current.status === 'executed') {
        const err = new Error(`提案 ${proposalId} 已执行完毕，无法驳回（仅 pending 状态允许驳回）`);
        (err as any).statusCode = 409;
        throw err;
      }
      if (current.status !== 'pending') {
        const err = new Error(`提案 ${proposalId} 当前状态为 [${current.status}]，不可驳回（仅 pending 状态允许驳回）`);
        (err as any).statusCode = 409;
        throw err;
      }
      const updated = proposalStore.updateProposalStatus(projectId, proposalId, 'dismissed', {
        description: reason || '创作者主动驳回',
      });
      if (!updated) {
        throw new Error(`[WorkflowEngine] 提案 ${proposalId} 更新失败`);
      }
      return updated;
    });
  }

  /**
   * 孤儿提案自愈扫描
   */
  public recoverOrphanProposals(): void {
    try {
      const projectStore = ProjectStore.getInstance();
      const proposalStore = ProposalStore.getInstance();
      const projects = projectStore.listProjects();

      for (const p of projects) {
        const runningList = proposalStore.listProposals(p.projectId, { status: 'running' as any });
        for (const orphan of runningList) {
          console.warn(`[WorkflowEngine] 检测到意外中断的孤儿提案 [${orphan.actionId}]，正在自动恢复为 failed...`);
          proposalStore.updateProposalStatus(p.projectId, orphan.actionId, 'failed', {
            failedAt: new Date().toISOString(),
            error: '系统进程异常重启，任务已自动置为失败，请重新执行',
          });
        }
      }
    } catch (err) {
      console.warn('[WorkflowEngine] 孤儿提案自愈扫描告警:', err);
    }
  }
}
