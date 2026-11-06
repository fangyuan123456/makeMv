/**
 * workflow-engine/workflow.ts
 * 纯单例驱动微内核工作流总控引擎 (Canonical Workflow Microkernel SSOT)
 *
 * 核心架构特性（遵循法典 0.3/0.4 极简微内核、高内聚与单一事实来源）：
 * 1. 唯一纯单例中枢：消灭散落的自由函数，所有工作流创建 (create)、注册 (register)、派发 (dispatch) 与执行 100% 统一由 Workflow 单例管理；
 * 2. 声明式参数化实例化：工序使用时直接传参 (id, steps, requireConfirmation)，由单例自动纳管并完成步骤切面编织；
 * 3. 原生 Mastra 驱动：底层持有 @mastra/core 原生工作流，Proxy 自动委托官方接口，完美接入 Mastra 容器；
 * 4. 彻底消灭虚假心跳：剥离 2 秒假定时器，进度 100% 由 WorkflowItem 真实步骤完成瞬间切面驱动。
 */

import { randomUUID } from 'crypto';
import { createWorkflow as mastraCreateWorkflow } from '@mastra/core/workflows';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { ProposalStore } from '../project-store/ProposalStore.js';
import { ProjectLockManager } from '../utils/projectLock.js';
import { SessionStatus, type ActionProposal } from '../types/index.js';
import { workflowTaskStorage, getCurrentTaskContext } from './WorkflowContextStorage.js';
import type {
  WorkflowRegistration,
  DispatchWorkflowOptions,
  DispatchWorkflowResult,
  ExecuteProposalOptions,
  ExecuteProposalResult,
  StartProposalResult,
} from './types.js';

export interface WorkflowStepItem<TStep = any> {
  /** 具体的 Mastra Step 实例或执行函数 */
  step: TStep;
  /** 该阶段所占权重比例 (例如 20 代表 20%)，可选 */
  weight?: number;
  /** 步骤中文说明 (可选，实时展示在前端进度条上方) */
  name?: string;
}

export interface NormalizedStepItem {
  rawStep: any;
  weight?: number;
  name?: string;
  index: number;
}

export interface CreateWorkflowOptions<TInput = any, TOutput = any> {
  id: string;
  title?: string;
  description?: string;
  inputSchema?: any;
  outputSchema?: any;
  /** 🌟 人在回路：是否需要人工在前端审批确认 (默认 false 全自动直通) */
  requireConfirmation?: boolean;
  /** 该工序所属法定业务阶段 (可选) */
  legalStage?: string;
  /** 🌟 核心步骤数组 (一次性传入，静态统筹步骤总数与进度归一化) */
  steps: Array<WorkflowStepItem | any>;
}

/**
 * 影视微内核工序工作流实例实体 (WorkflowItem)
 */
export class WorkflowItem<TInput = any, TOutput = any> {
  public readonly id: string;
  public readonly title: string;
  public readonly description?: string;
  public readonly requireConfirmation: boolean;
  public readonly legalStage?: string;
  public readonly totalSteps: number;
  public readonly steps: NormalizedStepItem[];

  /** 底层持有的 Mastra 原生微内核工作流实例 */
  public readonly nativeWorkflow: any;

  constructor(options: CreateWorkflowOptions<TInput, TOutput>) {
    const {
      id,
      title,
      description,
      requireConfirmation = false,
      legalStage,
      steps,
    } = options;

    if (!steps || steps.length === 0) {
      throw new Error(`[WorkflowItem] 工作流 [${id}] 未配置任何执行步骤 (steps 不能为空)`);
    }

    this.id = id;
    this.title = title || id;
    this.description = description;
    this.requireConfirmation = requireConfirmation;
    this.legalStage = legalStage;
    this.totalSteps = steps.length;

    // 1. 规范化步骤清单，提取权重配置
    this.steps = this.normalizeSteps(steps);

    // 2. 内部构建 Mastra 原生微内核流水线并编织进度切面
    this.nativeWorkflow = this.buildNativeMastraWorkflow(options);

    // 3. 🌟 透明代理：自身强类型属性优先，底层接口透明委托给 nativeWorkflow (如 createRun, stepGraph)
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        if (target.nativeWorkflow && prop in target.nativeWorkflow) {
          const val = target.nativeWorkflow[prop];
          return typeof val === 'function' ? val.bind(target.nativeWorkflow) : val;
        }
        return undefined;
      },
    });
  }

  private normalizeSteps(steps: Array<WorkflowStepItem | any>): NormalizedStepItem[] {
    return steps.map((item, index) => {
      const isConfig = item && typeof item === 'object' && 'step' in item;
      const rawStep = isConfig ? item.step : item;
      const weight = isConfig ? item.weight : undefined;
      const name = isConfig ? item.name : undefined;
      return { rawStep, weight, name, index };
    });
  }

  private buildNativeMastraWorkflow(options: CreateWorkflowOptions<TInput, TOutput>): any {
    const { id, description, inputSchema, outputSchema } = options;
    const totalDeclaredWeight = this.steps.reduce((acc, cur) => acc + (cur.weight || 0), 0);

    let wfBuilder = mastraCreateWorkflow({
      id,
      description,
      inputSchema,
      outputSchema,
    });

    let accumulatedWeight = 0;

    for (let i = 0; i < this.totalSteps; i++) {
      const { rawStep, weight, name, index } = this.steps[i];

      // 计算当前步骤完成时在全局推进中所占的真实比例
      let targetPercent: number;
      if (totalDeclaredWeight > 0 && weight !== undefined) {
        accumulatedWeight += weight;
        targetPercent = Math.min(95, Math.max(10, Math.round((accumulatedWeight / totalDeclaredWeight) * 95)));
      } else {
        // 缺省未传配置：底座根据 totalSteps 自动精准均分
        targetPercent = Math.min(95, Math.max(10, Math.round(((index + 1) / this.totalSteps) * 95)));
      }

      const stepLabel = name || (rawStep?.id ? `步骤 [${rawStep.id}]` : `第 ${index + 1}/${this.totalSteps} 阶段`);

      // 编织切面：包装 execute 方法
      const originalExecute = typeof rawStep === 'function' ? rawStep : rawStep.execute.bind(rawStep);
      const wrappedExecute = async (ctx: any) => {
        // 1. 原汁原味执行业务逻辑，业务函数内部 100% 零污染
        const result = await originalExecute(ctx);

        // 2. 步骤执行完成后，底座无侵入获取上下文并上报真实进度
        try {
          const taskCtx = getCurrentTaskContext();
          if (taskCtx) {
            ProposalStore.getInstance().updateProposalStatus(taskCtx.projectId, taskCtx.proposalId, 'running', {
              progress: { current: index + 1, total: this.totalSteps, percent: targetPercent },
              lastMessage: `${stepLabel} 推演完成 (${targetPercent}%)`,
            });
          }
        } catch {
          // 容错防崩，保证主干执行不受统计影响
        }

        return result;
      };

      const enhancedStep = typeof rawStep === 'function'
        ? wrappedExecute
        : {
            ...rawStep,
            execute: wrappedExecute,
          };

      // 🌟 底层使用 Mastra 原生的 then 串联！
      wfBuilder = wfBuilder.then(enhancedStep as any);
    }

    return wfBuilder.commit();
  }

  /**
   * 统一执行入口 (遵循 Mastra 官方微内核 createRun 契约直通)
   */
  public async execute(args: { inputData: TInput }): Promise<TOutput> {
    const run = await this.nativeWorkflow.createRun();
    const runResult = await run.start({ inputData: args.inputData });
    const output = runResult?.result !== undefined ? runResult.result : runResult;
    return output as TOutput;
  }
}

/**
 * 纯单例驱动微内核工作流总控中枢 (Workflow SSOT)
 */
export class Workflow {
  private static instance?: Workflow;
  private registrations = new Map<string, WorkflowRegistration>();
  private activeTasks = new Map<string, Promise<ExecuteProposalResult>>();

  public static getInstance(): Workflow {
    if (!Workflow.instance) {
      Workflow.instance = new Workflow();
    }
    return Workflow.instance;
  }

  /**
   * 🌟 唯一工作流创建入口：由单例统一创建并自动纳管注册
   */
  public create<TInput = any, TOutput = any>(
    options: CreateWorkflowOptions<TInput, TOutput>
  ): WorkflowItem<TInput, TOutput> {
    const item = new WorkflowItem<TInput, TOutput>(options);
    this.register({
      key: item.id,
      title: item.title,
      legalStage: item.legalStage,
      requireConfirmation: item.requireConfirmation,
      execute: (item.execute.bind(item) as any),
    });
    return item;
  }

  /**
   * 静态快捷创建门面（委托给单例）
   */
  public static create<TInput = any, TOutput = any>(
    options: CreateWorkflowOptions<TInput, TOutput>
  ): WorkflowItem<TInput, TOutput> {
    return Workflow.getInstance().create<TInput, TOutput>(options);
  }

  public register(registration: WorkflowRegistration): void {
    this.registrations.set(registration.key, registration);
  }

  public registerWorkflow(registration: WorkflowRegistration): void {
    this.registrations.set(registration.key, registration);
  }

  public getRegistration(key: string): WorkflowRegistration | undefined {
    return this.registrations.get(key);
  }

  public getHandler(key: string): any {
    return this.registrations.get(key)?.execute;
  }

  /**
   * 判断工序是否需要人在回路审批 (源头声明式契约驱动 SSOT)
   */
  public isConfirmationRequired(
    workflowKey: string,
    explicitOverride?: boolean,
    actionType?: string
  ): boolean {
    if (explicitOverride !== undefined) {
      return explicitOverride;
    }
    // 创作者明确发出的定向微调指令，全自动直通执行
    if (actionType === 'TARGETED_REVISE') {
      return false;
    }
    const reg = this.registrations.get(workflowKey);
    if (reg?.requireConfirmation !== undefined) {
      return reg.requireConfirmation;
    }
    return false;
  }

  /**
   * 统一业务派发入口：生成提案并处理人在回路拦截或自动启动
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
      affectedSteps,
      parameters,
      requireConfirmation,
    } = options;

    const projectStore = ProjectStore.getInstance();
    const proposalStore = ProposalStore.getInstance();

    const project = projectStore.getProject(projectId);
    if (!project) {
      throw new Error(`[Workflow] 未找到项目: ${projectId}`);
    }

    const reg = this.registrations.get(workflowKey);
    const finalTitle = title || reg?.title || `执行工序: ${workflowKey}`;
    const needsApproval = this.isConfirmationRequired(workflowKey, requireConfirmation, actionType);

    // 🌟 提案幂等：同 session 下相同 skill 且处于 pending 态的提案，连发时直接复用，不产生冗余孤儿卡片
    if (sessionId) {
      const existingPending = proposalStore
        .listProposals(projectId, { status: 'pending' })
        .find((p) => p.sessionId === sessionId && p.skill === workflowKey);
      if (existingPending) {
        if (userPrompt || parameters) {
          existingPending.payload = {
            ...(existingPending.payload || {}),
            ...(parameters || {}),
            ...(userPrompt ? { userPrompt } : {}),
            ...(reason ? { reason } : {}),
          };
          proposalStore.saveProposal(projectId, existingPending);
        }
        return {
          success: true,
          proposalId: existingPending.actionId,
          proposal: existingPending,
          summary: `复用已有待确认提案: ${finalTitle}`,
          isReused: true,
          autoStarted: false,
        };
      }
    }

    const proposal: ActionProposal = {
      actionId: `act_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      projectId,
      sessionId,
      skill: workflowKey,
      actionType,
      label: finalTitle,
      description: reason || userPrompt || finalTitle,
      status: 'pending',
      affectedSteps: affectedSteps || [workflowKey],
      payload: { ...(parameters || {}), userPrompt, reason },
      createdAt: new Date().toISOString(),
    };

    proposalStore.saveProposal(projectId, proposal);

    if (needsApproval) {
      return {
        success: true,
        proposalId: proposal.actionId,
        proposal,
        summary: `已创建待确认提案: ${finalTitle}`,
        autoStarted: false,
      };
    }

    // 默认全自动直通执行
    const startRes = await this.startProposal({ projectId, proposalId: proposal.actionId });
    return {
      success: true,
      proposalId: proposal.actionId,
      proposal: startRes.proposal,
      summary: `已启动工序: ${finalTitle}`,
      autoStarted: true,
    };
  }

  /**
   * 启动并执行提案 (人在回路批准点击或自动直通)
   */
  public async startProposal(options: ExecuteProposalOptions): Promise<StartProposalResult> {
    const { projectId, proposalId, overrideParameters } = options;
    const lock = ProjectLockManager.getInstance();

    return lock.withLock(projectId, async () => {
      const projectStore = ProjectStore.getInstance();
      const proposalStore = ProposalStore.getInstance();

      const proposal = proposalStore.getProposal(projectId, proposalId);
      if (!proposal) {
        throw new Error(`[Workflow] 未找到提案: ${proposalId}`);
      }

      if (proposal.status === 'running' || this.activeTasks.has(proposalId)) {
        return { accepted: true, proposal };
      }

      if (proposal.status !== 'pending') {
        throw new Error(`[Workflow] 提案处于非可执行状态 [${proposal.status}]，禁止执行！`);
      }

      const workflowKey = proposal.skill;
      if (!workflowKey) {
        throw new Error(`[Workflow] 提案 [${proposalId}] 缺少合法的 workflowKey/skill 标识`);
      }

      const reg = this.registrations.get(workflowKey);
      if (!reg) {
        throw new Error(`[Workflow] 未找到已注册的工序执行器: ${workflowKey}`);
      }

      // 质检门禁刚性拦截
      if (reg.validateGate) {
        const gateResult = reg.validateGate({
          projectId,
          sessionId: proposal.sessionId,
          proposalId,
          actionType: proposal.actionType,
          payload: { ...(proposal.payload || {}), ...overrideParameters },
        });
        if (!gateResult.pass) {
          throw new Error(`[Workflow] 门禁拦截: ${gateResult.reason || '工序未通过前置门禁质检'}`);
        }
      }

      // 将状态更新为 running，初始化初始进度 10% (规范单一事实进度契约)
      const runningProposal = proposalStore.updateProposalStatus(projectId, proposalId, 'running', {
        startedAt: new Date().toISOString(),
        progress: { current: 0, total: 1, percent: 10 },
      });

      const project = projectStore.getProject(projectId);
      if (project) {
        project.status = SessionStatus.RUNNING;
        project.updatedAt = new Date().toISOString();
        projectStore.saveProject(project);
      }

      // 异步后台触发执行，绝不阻塞当前 HTTP 请求
      const taskPromise = this.runProposalTask(projectId, proposalId, reg, overrideParameters);
      this.activeTasks.set(proposalId, taskPromise);

      taskPromise.finally(() => {
        this.activeTasks.delete(proposalId);
      });

      return {
        accepted: true,
        proposal: runningProposal || proposal,
      };
    });
  }

  /**
   * 后台异步执行具体的工序任务 (100% 真实 Step 驱动，彻底消灭虚假心跳)
   */
  private async runProposalTask(
    projectId: string,
    proposalId: string,
    registration?: WorkflowRegistration,
    overrideParameters?: Record<string, any>
  ): Promise<ExecuteProposalResult> {
    const projectStore = ProjectStore.getInstance();
    const proposalStore = ProposalStore.getInstance();

    const proposal = proposalStore.getProposal(projectId, proposalId);
    if (!proposal) {
      throw new Error(`[Workflow] 后台任务异常: 提案 [${proposalId}] 不存在`);
    }

    // 终态核验防御：若提案已处于终态 (dismissed / executed / failed)，绝对不能覆盖执行
    if (proposal.status !== 'pending' && proposal.status !== 'running') {
      return {
        success: false,
        proposal,
        error: `提案处于终态 [${proposal.status}]，禁止执行！`,
      };
    }

    const targetReg = registration || (proposal.skill ? this.registrations.get(proposal.skill) : undefined);
    if (!targetReg) {
      throw new Error(`[Workflow] 未找到提案 [${proposalId}] 对应的工序注册`);
    }

    const project = projectStore.getProject(projectId);
    const cleanPayload = { ...(proposal.payload || {}) };
    const startTime = Date.now();

    try {
      console.log(`[Workflow] 后台开始执行工序: key=${targetReg.key}, project=${projectId}`);
      const userFeedbackText =
        cleanPayload.userPrompt ||
        cleanPayload.feedback ||
        cleanPayload.userFeedback ||
        cleanPayload.reason ||
        proposal.description;

      const inputData = {
        projectId,
        sessionId: proposal.sessionId,
        activeStage: (project as any)?.currentStage,
        targetSkill: targetReg.key,
        feedback: userFeedbackText,
        payload: { ...cleanPayload, proposalId, targetSkill: targetReg.key, skill: targetReg.key },
        overrideParams: overrideParameters,
      };

      const executeFn =
        typeof targetReg.execute === 'function'
          ? targetReg.execute
          : (targetReg.execute as any).execute.bind(targetReg.execute);

      // 🌟 底座异步上下文注入：底层工具与封装的 Workflow 自动感知当前 proposalId
      const stepOutput = await workflowTaskStorage.run(
        {
          projectId,
          proposalId,
          skill: targetReg.key,
          stage: (project as any)?.currentStage,
          startTime,
        },
        async () => await executeFn({ inputData })
      );

      const toolResult = stepOutput?.toolResult;
      if (toolResult?.error || toolResult?.success === false) {
        throw new Error(toolResult.error || toolResult.message || '工序返回明确失败');
      }

      // 终态核验防御：若执行期间提案被人为驳回或修改，放弃覆盖写入 executed
      const latestCheck = proposalStore.getProposal(projectId, proposalId);
      if (latestCheck && latestCheck.status !== 'running') {
        console.warn(`[Workflow] 提案 [${proposalId}] 执行中已被修改为 [${latestCheck.status}]，放弃覆盖终态`);
        return {
          success: false,
          proposal: latestCheck,
          error: `提案已被修改为 [${latestCheck.status}]`,
        };
      }

      // 工序成功执行完毕：底座硬敲 100%
      const updatedProposal = proposalStore.updateProposalStatus(projectId, proposalId, 'executed', {
        executedAt: new Date().toISOString(),
        progress: { current: 100, total: 100, percent: 100 },
        resultSummary: stepOutput?.lastSummary || `工序 [${targetReg.key}] 执行成功`,
      });

      // 触发业务生命周期流转钩子
      if (targetReg.onSuccess) {
        try {
          await targetReg.onSuccess({
            projectId,
            sessionId: proposal.sessionId,
            proposalId,
            actionType: proposal.actionType,
            payload: inputData.payload,
            result: toolResult || stepOutput,
          });
        } catch (hookErr: any) {
          console.warn(`[Workflow] 工序 [${targetReg.key}] onSuccess 钩子执行警告:`, hookErr.message);
        }
      }

      // 更新项目聚合状态
      const currentProject = projectStore.getProject(projectId);
      if (currentProject) {
        const pendingList = proposalStore.listProposals(projectId, { status: 'pending' });
        currentProject.status =
          pendingList.length > 0 ? SessionStatus.WAITING_FOR_INTERVENTION : SessionStatus.IDLE;
        currentProject.updatedAt = new Date().toISOString();
        projectStore.saveProject(currentProject);
      }

      return {
        success: true,
        proposal: updatedProposal || proposal,
        result: toolResult || stepOutput,
      };
    } catch (err: any) {
      console.error(`[Workflow] 提案 [${proposalId}] 执行失败:`, err);
      const latestProposal = proposalStore.getProposal(projectId, proposalId);
      if (latestProposal && latestProposal.status === 'running') {
        proposalStore.updateProposalStatus(projectId, proposalId, 'failed', {
          failedAt: new Date().toISOString(),
          error: err.message || '执行异常',
        });
      }
      const currentProject = projectStore.getProject(projectId);
      if (currentProject) {
        currentProject.status = SessionStatus.FAILED;
        currentProject.updatedAt = new Date().toISOString();
        projectStore.saveProject(currentProject);
      }
      return {
        success: false,
        proposal: latestProposal || proposal,
        error: err.message,
      };
    }
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
    const current = proposalStore.getProposal(options.projectId, proposalId);
    return {
      success: current?.status === 'executed',
      proposal: current!,
      error: current?.error,
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
   * 创作者主动驳回提案
   */
  public async rejectProposal(projectId: string, proposalId: string, reason?: string): Promise<ActionProposal> {
    const lock = ProjectLockManager.getInstance();
    return lock.withLock(projectId, async () => {
      const proposalStore = ProposalStore.getInstance();
      const current = proposalStore.getProposal(projectId, proposalId);
      if (!current) {
        throw new Error(`[Workflow] 提案 ${proposalId} 不存在`);
      }
      if (current.status === 'running' || this.activeTasks.has(proposalId)) {
        const err = new Error(`提案 ${proposalId} 正在执行中，不可驳回`);
        (err as any).statusCode = 409;
        throw err;
      }
      if (current.status === 'executed') {
        const err = new Error(`提案 ${proposalId} 已执行完毕，无法驳回（仅 pending 允许驳回）`);
        (err as any).statusCode = 409;
        throw err;
      }
      if (current.status !== 'pending') {
        const err = new Error(`提案 ${proposalId} 当前状态为 [${current.status}]，不可驳回（仅 pending 允许驳回）`);
        (err as any).statusCode = 409;
        throw err;
      }
      const updated = proposalStore.updateProposalStatus(projectId, proposalId, 'dismissed', {
        description: reason || '创作者主动驳回',
      });
      if (!updated) {
        throw new Error(`[Workflow] 提案 ${proposalId} 更新失败`);
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
          console.warn(`[Workflow] 检测到中断的孤儿提案 [${orphan.actionId}]，自动恢复为 failed...`);
          proposalStore.updateProposalStatus(p.projectId, orphan.actionId, 'failed', {
            failedAt: new Date().toISOString(),
            error: '系统进程异常重启，任务已自动置为失败',
          });
        }
      }
    } catch (err) {
      console.warn('[Workflow] 孤儿自愈扫描告警:', err);
    }
  }
}
