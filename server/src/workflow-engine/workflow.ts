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
import { isCriticReportKey } from '../project-store/critic-report.js';
import { TaskStore } from '../project-store/TaskStore.js';
import { ProjectLockManager } from '../utils/projectLock.js';
import { SessionStatus, type Task, type TaskArtifact } from '../types/index.js';
import { deriveTaskIntent } from '../types/task.js';
import { workflowTaskStorage, getCurrentTaskContext } from './WorkflowContextStorage.js';
import type {
  WorkflowRegistration,
  DispatchWorkflowOptions,
  DispatchWorkflowResult,
  ExecuteTaskOptions,
  ExecuteTaskResult,
  StartTaskResult,
} from './types.js';

export interface WorkflowStepItem<TStep = any> {
  /** 具体的 Mastra Step 实例或执行函数 */
  step: TStep;
  /** 该阶段所占权重比例 (例如 20 代表 20%)，可选 */
  weight?: number;
  /** 步骤中文说明 (可选，实时展示在前端进度条上方) */
  name?: string;
  /**
   * 运行时跳过判定 (可选)：返回 true 时该步骤完全不执行、不上报进度，原样透传输入。
   *
   * 用于「多条互斥分支串在同一条 workflow 上」的场景：一次请求只命中其中一条，
   * 其余分支保持静默。静默是关键——若照常广播「XX 执行中…」，进度文案会在
   * 互斥分支之间来回跳，用户看到的是自己没请求的工序在跑。
   */
  skipIf?: (inputData: any) => boolean;
}

export interface NormalizedStepItem {
  rawStep: any;
  weight?: number;
  name?: string;
  skipIf?: (inputData: any) => boolean;
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
  /**
   * 运行时权重解析器 (可选)。
   *
   * 静态 weight 无法表达「同一组步骤在不同数据形态下耗时结构完全不同」的情况：
   * 文本修改 60% 花在推演、视频修改 80% 花在渲染，共用一套权重必然失真。
   * 该回调按本次输入返回与 steps 等长的权重数组；返回 undefined 或长度不符时，
   * 自动回落静态权重（再回落按步数均分）。
   */
  weightResolver?: (inputData: any) => number[] | undefined;
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
      const skipIf = isConfig && typeof item.skipIf === 'function' ? item.skipIf : undefined;
      return { rawStep, weight, name, skipIf, index };
    });
  }

  /**
   * 按权重数组计算「第 upto 个步骤完成时」的全局百分比。
   * 统一映射到 10~95 区间：起步不显示 0%，留 5% 给最终落盘确认。
   */
  private static percentAt(weights: number[], upto: number): number {
    const total = weights.reduce((acc, cur) => acc + cur, 0);
    if (total <= 0) return 10;
    const accumulated = weights.slice(0, upto).reduce((acc, cur) => acc + cur, 0);
    return Math.min(95, Math.max(10, Math.round((accumulated / total) * 95)));
  }

  private buildNativeMastraWorkflow(options: CreateWorkflowOptions<TInput, TOutput>): any {
    const { id, description, inputSchema, outputSchema, weightResolver } = options;
    const totalDeclaredWeight = this.steps.reduce((acc, cur) => acc + (cur.weight || 0), 0);

    let wfBuilder = mastraCreateWorkflow({
      id,
      description,
      inputSchema,
      outputSchema,
    });

    let accumulatedWeight = 0;

    for (let i = 0; i < this.totalSteps; i++) {
      const { rawStep, weight, name, skipIf, index } = this.steps[i];

      // 计算当前步骤完成时在全局推进中所占的真实比例
      // prevPercent：本步开始前已完成的进度（用于「执行中」即时上报）
      const prevPercent =
        totalDeclaredWeight > 0 && weight !== undefined
          ? Math.min(95, Math.max(10, Math.round((accumulatedWeight / totalDeclaredWeight) * 95)))
          : Math.min(95, Math.max(10, Math.round((index / this.totalSteps) * 95)));

      let targetPercent: number;
      if (totalDeclaredWeight > 0 && weight !== undefined) {
        accumulatedWeight += weight;
        targetPercent = Math.min(95, Math.max(10, Math.round((accumulatedWeight / totalDeclaredWeight) * 95)));
      } else {
        // 缺省未传配置：底座根据 totalSteps 自动精准均分
        targetPercent = Math.min(95, Math.max(10, Math.round(((index + 1) / this.totalSteps) * 95)));
      }

      const stepLabel = name || (rawStep?.id ? `步骤 [${rawStep.id}]` : `第 ${index + 1}/${this.totalSteps} 阶段`);

      // 进度广播（业务代码零侵入）：仅在有任务上下文时生效，进度只写 Task
      const broadcastProgress = (
        percent: number,
        currentStep: number,
        totalSteps: number,
        message: string
      ) => {
        try {
          const taskCtx = getCurrentTaskContext();
          if (!taskCtx) return;
          TaskStore.getInstance().patchTask(taskCtx.projectId, taskCtx.taskId, {
            status: 'running',
            progress: { current: currentStep, total: totalSteps, percent, note: message },
          });
        } catch {
          // 容错防崩，保证主干执行不受统计影响
        }
      };

      // 编织切面：包装 execute 方法
      const originalExecute = typeof rawStep === 'function' ? rawStep : rawStep.execute.bind(rawStep);
      const wrappedExecute = async (ctx: any) => {
        const runtimeInput = ctx?.inputData;

        // 0. 互斥分支静默透传：本步不属于本次请求 → 不执行、不上报，原样把输入交给下一步
        if (skipIf) {
          let shouldSkip = false;
          try {
            shouldSkip = Boolean(skipIf(runtimeInput));
          } catch {
            shouldSkip = false; // 判定本身异常时按「不跳过」处理，避免误吞真实工序
          }
          if (shouldSkip) return runtimeInput;
        }

        // 1. 解析本次运行的真实权重（未配置或形状不符时回落静态声明）
        //    effectiveTotal/effectiveCurrent：互斥分支场景下，分母只算真正会执行的那条，
        //    否则改文本会显示「第 1/3 步」、改视频会显示「第 3/3 步」，用户看到的步数并不存在。
        let startPercent = prevPercent;
        let endPercent = targetPercent;
        let effectiveTotal = this.totalSteps;
        let effectiveCurrent = index + 1;
        if (weightResolver) {
          try {
            const runtimeWeights = weightResolver(runtimeInput);
            if (
              runtimeWeights &&
              runtimeWeights.length === this.totalSteps &&
              runtimeWeights.some((w) => w > 0)
            ) {
              startPercent = WorkflowItem.percentAt(runtimeWeights, index);
              endPercent = WorkflowItem.percentAt(runtimeWeights, index + 1);

              const activeCount = runtimeWeights.filter((w) => w > 0).length;
              effectiveTotal = activeCount || this.totalSteps;
              effectiveCurrent = runtimeWeights.slice(0, index).filter((w) => w > 0).length + 1;
            }
          } catch {
            // 权重解析失败不影响主干，沿用静态权重
          }
        }

        // 2. 执行前：让客户端立刻看到「当前正在做什么」
        broadcastProgress(startPercent, effectiveCurrent, effectiveTotal, `${stepLabel} 执行中…`);

        // 3. 注入子阶段上报通道：step 内部可按真实阶段推进进度，
        //    精度高于按步骤均分（spec 自己知道哪一段是重 IO）。
        //    进度只允许单调前进，且不越过本步的收尾百分比。
        const report = (percent: number, message: string) => {
          const clamped = Math.min(endPercent, Math.max(startPercent, Math.round(percent)));
          broadcastProgress(clamped, effectiveCurrent, effectiveTotal, message);
        };

        // 4. 原汁原味执行业务逻辑，业务函数内部 100% 零污染
        const result = await originalExecute({ ...ctx, report });

        // 5. 步骤执行完成后，底座无侵入上报真实进度
        broadcastProgress(endPercent, effectiveCurrent, effectiveTotal, `${stepLabel} 推演完成 (${endPercent}%)`);

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

    // 🌟 失败显式上抛：Mastra run.start 步骤失败时不抛异常，只返回 {status:'failed', error}。
    //    若不检查，失败会被静默吞掉，底座拿不到 lastSummary/toolResult，误标提案"执行成功"，
    //    客户端将永远等待永不落盘的工序产物 (右侧工坊面板无限加载)。
    if (runResult?.status === 'failed') {
      const err = runResult?.error;
      const msg =
        err?.message ||
        (typeof err === 'string' ? err : JSON.stringify(err)?.slice(0, 500)) ||
        '子工作流步骤执行失败 (未提供错误详情)';
      throw new Error(`[WorkflowItem:${this.id}] ${msg}`);
    }

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
  /** 正在执行的 taskId → 执行 Promise（仅执行中，不含排队中） */
  private activeTasks = new Map<string, Promise<ExecuteTaskResult>>();
  /**
   * 每项目一条串行执行链（链尾 Promise）。
   *
   * 同一项目的两个任务并发执行会互相覆盖：两支微调在 load 段各读一份旧底稿，
   * commit 段后写覆盖前写，两条任务都标 succeeded，用户改的第一处被静默吃掉。
   * 因此同一项目同时只跑一个任务，后来的排队等待。
   */
  private projectChains = new Map<string, Promise<void>>();
  /** 项目当前真正占着执行位的 taskId（排队中的不算） */
  private projectActiveTask = new Map<string, string>();
  /** 已排入执行链的 taskId，用于 startTask 幂等（重复批准不得重复入队） */
  private scheduledTasks = new Set<string>();
  /** 已排入执行链任务的最终执行 Promise（等待方据此拿到真实结果，而不是排队快照） */
  private scheduledPromises = new Map<string, Promise<ExecuteTaskResult>>();

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

  /** 该项目是否有任务在执行或排队（判定「现在启动会不会撞车」） */
  public isProjectBusy(projectId: string): boolean {
    return this.projectChains.has(projectId) || this.projectActiveTask.has(projectId);
  }

  /** 项目当前真正在跑的 taskId（排队中的不返回，用于取消拦截判定） */
  public getProjectActiveTask(projectId: string): string | undefined {
    return this.projectActiveTask.get(projectId);
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
   * 统一业务派发入口：创建任务（Task）并处理人在回路拦截或自动启动
   *
   * 任务在这里诞生：意图识别 → 任务（proposed 待确认 / 直接 queued）。此后的状态与产物
   * 只写在 Task 上，对话消息仅保存 taskId。
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
    const taskStore = TaskStore.getInstance();

    const project = projectStore.getProject(projectId);
    if (!project) {
      throw new Error(`[Workflow] 未找到项目: ${projectId}`);
    }

    const reg = this.registrations.get(workflowKey);
    const finalTitle = title || reg?.title || `执行工序: ${workflowKey}`;
    const needsApproval = this.isConfirmationRequired(workflowKey, requireConfirmation, actionType);

    // 任务幂等：同 session 下相同 skill 且仍待确认的任务，连发时直接复用，不产生冗余孤儿任务
    if (sessionId) {
      const existingProposed = taskStore
        .listTasks(projectId, { status: 'proposed' })
        .find((t) => t.sessionId === sessionId && t.skill === workflowKey);
      /*
       * 意图一致性校验：actionType 不同说明这是新意图（如 PROCEED_STAGE 待审时来了 TARGETED_REVISE）。
       * 若照旧复用，新指令会被灌进旧任务壳：actionType 仍是 PROCEED_STAGE → 微调轨失效走全量重推；
       * 且免审批意图也会被旧 proposed 卡拦截（autoStarted:false）而根本不启动。必须放行去创建新任务。
       */
      const sameIntent =
        !existingProposed || (existingProposed.actionType || 'PROCEED_STAGE') === actionType;
      if (existingProposed && sameIntent) {
        if (userPrompt || parameters) {
          const merged = {
            ...(existingProposed.payload || {}),
            ...(parameters || {}),
            ...(userPrompt ? { userPrompt } : {}),
            ...(reason ? { reason } : {}),
          };
          const updated = taskStore.patchTask(projectId, existingProposed.taskId, { payload: merged });
          return {
            success: true,
            taskId: existingProposed.taskId,
            task: updated || existingProposed,
            summary: `复用已有待确认任务: ${finalTitle}`,
            isReused: true,
            autoStarted: false,
          };
        }
        return {
          success: true,
          taskId: existingProposed.taskId,
          task: existingProposed,
          summary: `复用已有待确认任务: ${finalTitle}`,
          isReused: true,
          autoStarted: false,
        };
      }
    }

    const task: Task = {
      taskId: `task_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      projectId,
      sessionId,
      intent: deriveTaskIntent(actionType, workflowKey),
      skill: workflowKey,
      actionType,
      title: finalTitle,
      description: reason || userPrompt || finalTitle,
      status: needsApproval ? 'proposed' : 'queued',
      stages: affectedSteps || [workflowKey],
      approval: { required: needsApproval },
      payload: { ...(parameters || {}), userPrompt, reason },
      artifacts: [],
      createdAt: new Date().toISOString(),
    };

    taskStore.saveTask(projectId, task);

    if (needsApproval) {
      return {
        success: true,
        taskId: task.taskId,
        task,
        summary: `已创建待确认任务: ${finalTitle}`,
        autoStarted: false,
      };
    }

    // 默认全自动直通执行。免审批任务 dispatch 即 queued；
    // startTask 的前置校验（门禁拦截 / 缺注册 / 非可执行状态）在置 running 之前抛错，
    // 若不兜底，任务会永久卡在 queued，客户端对 queued 持续轮询形成死循环。
    try {
      const startRes = await this.startTask({ projectId, taskId: task.taskId });
      // 项目内有任务正在跑时，本任务只会进入排队，文案不能说「已启动」
      const waiting = startRes.task?.status === 'queued';
      return {
        success: true,
        taskId: task.taskId,
        task: startRes.task,
        summary: waiting ? `已排入执行队列: ${finalTitle}` : `已启动工序: ${finalTitle}`,
        autoStarted: !waiting,
      };
    } catch (err: any) {
      taskStore.setStatus(projectId, task.taskId, 'failed', {
        error: `自动启动失败: ${err?.message || '未知异常'}`,
      });
      const failedTask = taskStore.getTask(projectId, task.taskId) || task;
      return {
        success: false,
        taskId: task.taskId,
        task: failedTask,
        summary: `工序启动失败: ${err?.message || '未知异常'}`,
        autoStarted: false,
      };
    }
  }

  /**
   * 任务失败时在对话气泡里补一条事实说明。
   *
   * 为什么必须有：气泡正文是派发前由模型生成的，那时它并不知道任务会失败，
   * 所以正文里很可能已经写着「已为你改好…」。任务失败后若不纠正，用户看到的
   * 就是「看起来成功的失败」——产物一个字没变，正文却说变了。
   *
   * 这里不改写历史正文（那是用户已经读过的内容），只在同一气泡末尾追加事实；
   * 找不到引用该 taskId 的消息时由 store 回退为新增一条，语义不会丢。
   */
  private announceTaskFailure(task: Task | undefined, reason: string): void {
    if (!task?.sessionId) return;
    try {
      ProjectStore.getInstance().appendToLastTaskMessage(
        task.projectId,
        task.sessionId,
        task.taskId,
        `⚠️ 本次操作未生效：${reason}`
      );
    } catch (err: any) {
      console.warn(`[Workflow] 失败说明写入对话失败: ${err?.message || '未知异常'}`);
    }
  }

  /**
   * 启动并执行任务 (人在回路批准点击或自动直通)
   */
  public async startTask(options: ExecuteTaskOptions): Promise<StartTaskResult> {
    const { projectId, taskId, overrideParameters } = options;
    const lock = ProjectLockManager.getInstance();

    return lock.withLock(projectId, async () => {
      const projectStore = ProjectStore.getInstance();
      const taskStore = TaskStore.getInstance();

      const task = taskStore.getTask(projectId, taskId);
      if (!task) {
        throw new Error(`[Workflow] 未找到任务: ${taskId}`);
      }

      // 重复批准幂等：已在执行或已排入执行链的任务不再二次入队
      if (task.status === 'running' || this.activeTasks.has(taskId) || this.scheduledTasks.has(taskId)) {
        return { accepted: true, task };
      }

      if (task.status !== 'proposed' && task.status !== 'queued') {
        throw new Error(`[Workflow] 任务处于非可执行状态 [${task.status}]，禁止执行！`);
      }

      const workflowKey = task.skill;
      if (!workflowKey) {
        throw new Error(`[Workflow] 任务 [${taskId}] 缺少合法的 workflowKey/skill 标识`);
      }

      const reg = this.registrations.get(workflowKey);
      if (!reg) {
        throw new Error(`[Workflow] 未找到已注册的工序执行器: ${workflowKey}`);
      }

      // 质检门禁刚性拦截
      if (reg.validateGate) {
        const gateResult = reg.validateGate({
          projectId,
          sessionId: task.sessionId,
          taskId,
          actionType: task.actionType,
          payload: { ...(task.payload || {}), ...overrideParameters },
        });
        if (!gateResult.pass) {
          throw new Error(`[Workflow] 门禁拦截: ${gateResult.reason || '工序未通过前置门禁质检'}`);
        }
      }

      // 同一项目同时只允许一个任务占执行位：后来的进入 queued 排队，而不是并发跑。
      // 排队而不是拒绝，是因为用户连续下两条修改指令时，两条都应该落地（按序）。
      const busy = this.isProjectBusy(projectId);
      const now = new Date().toISOString();
      const acceptedTask = taskStore.patchTask(projectId, taskId, {
        status: busy ? 'queued' : 'running',
        startedAt: busy ? undefined : now,
        approval: { required: task.approval?.required ?? true, approvedAt: now },
        progress: busy
          ? undefined
          : { current: 0, total: 1, percent: 10, note: '任务已启动，正在准备执行' },
      });

      if (!busy) {
        // 空闲：直接预占执行位，避免「置了 running 却没人执行」的空窗
        this.projectActiveTask.set(projectId, taskId);
        const project = projectStore.getProject(projectId);
        if (project) {
          project.status = SessionStatus.RUNNING;
          project.updatedAt = now;
          projectStore.saveProject(project);
        }
      }

      // 异步后台触发执行，绝不阻塞当前 HTTP 请求。
      // 排队任务在真正轮到它时才置 running（见 beginScheduledTask），
      // 所以客户端看到的 queued 是「确实在排队」，running 才是「确实在跑」。
      this.scheduleProjectTask(projectId, taskId, reg, overrideParameters);

      return {
        accepted: true,
        task: acceptedTask || task,
      };
    });
  }

  /**
   * 把任务挂到项目执行链尾部（FIFO）。返回链上这一节的 Promise，调用方可选择等待。
   */
  private scheduleProjectTask(
    projectId: string,
    taskId: string,
    registration: WorkflowRegistration | undefined,
    overrideParameters?: Record<string, any>
  ): Promise<ExecuteTaskResult> {
    const taskStore = TaskStore.getInstance();

    if (this.scheduledTasks.has(taskId)) {
      const tracked = this.scheduledPromises.get(taskId);
      if (tracked) return tracked;
      const existing = taskStore.getTask(projectId, taskId);
      if (existing) {
        return Promise.resolve({ success: true, task: existing });
      }
    }
    this.scheduledTasks.add(taskId);

    const tail = this.projectChains.get(projectId) || Promise.resolve();
    const runner = tail
      // 前序任务失败/异常不得阻断后续排队任务
      .catch(() => undefined)
      .then(() => this.beginScheduledTask(projectId, taskId, registration, overrideParameters))
      .catch((err: any): ExecuteTaskResult => {
        console.error(`[Workflow] 排队任务 [${taskId}] 执行未捕获异常:`, err);
        const latest = taskStore.getTask(projectId, taskId);
        // 只救「还没结算」的任务，已被驳回的不能改写成 failed
        if (latest && (latest.status === 'running' || latest.status === 'queued')) {
          const failedTask = taskStore.setStatus(projectId, taskId, 'failed', {
            error: err?.message || '后台执行异常',
          });
          if (failedTask) return { success: false, task: failedTask, error: err?.message };
        }
        return { success: false, task: latest as Task, error: err?.message };
      });

    // 链尾只存「已结束」信号，绝不携带 rejection，否则一次失败会让后续任务全部短路
    const chainTail = runner.then(
      () => undefined,
      () => undefined
    );
    this.projectChains.set(projectId, chainTail);
    this.scheduledPromises.set(taskId, runner);
    chainTail.then(() => {
      this.scheduledTasks.delete(taskId);
      this.scheduledPromises.delete(taskId);
      // 只有自己仍是链尾时才回收项目执行位，避免误清后来者的锁
      if (this.projectChains.get(projectId) === chainTail) {
        this.projectChains.delete(projectId);
        this.projectActiveTask.delete(projectId);
      }
    });

    return runner;
  }

  /**
   * 排队任务轮到自己时的开场：二次校验状态 → 置 running → 真正执行。
   */
  private async beginScheduledTask(
    projectId: string,
    taskId: string,
    registration: WorkflowRegistration | undefined,
    overrideParameters?: Record<string, any>
  ): Promise<ExecuteTaskResult> {
    const projectStore = ProjectStore.getInstance();
    const taskStore = TaskStore.getInstance();

    const pending = taskStore.getTask(projectId, taskId);
    if (!pending) {
      throw new Error(`[Workflow] 排队任务 [${taskId}] 不存在，无法执行`);
    }

    // 空闲起步的任务在入队时已把自己标成 running 并预占执行位，
    // 这里不能把它当作「状态已变」跳过，否则任务会永久幽灵 running。
    const reserved = this.projectActiveTask.get(projectId) === taskId;
    const startable =
      pending.status === 'queued' ||
      pending.status === 'proposed' ||
      (reserved && pending.status === 'running');
    if (!startable) {
      console.log(`[Workflow] 排队任务 [${taskId}] 已变为 [${pending.status}]，跳过执行`);
      return {
        success: false,
        task: pending,
        error: `任务已被修改为 [${pending.status}]，不再执行`,
      };
    }

    const now = new Date().toISOString();
    if (!reserved) {
      this.projectActiveTask.set(projectId, taskId);
      taskStore.patchTask(projectId, taskId, {
        status: 'running',
        startedAt: now,
        progress: { current: 0, total: 1, percent: 10, note: '任务已启动，正在准备执行' },
      });

      const project = projectStore.getProject(projectId);
      if (project) {
        project.status = SessionStatus.RUNNING;
        project.updatedAt = now;
        projectStore.saveProject(project);
      }
    }

    const execution = this.runTask(projectId, taskId, registration, overrideParameters);
    this.activeTasks.set(taskId, execution);
    try {
      return await execution;
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  /**
   * 后台异步执行具体的工序任务 (100% 真实 Step 驱动，彻底消灭虚假心跳)
   */
  private async runTask(
    projectId: string,
    taskId: string,
    registration?: WorkflowRegistration,
    overrideParameters?: Record<string, any>
  ): Promise<ExecuteTaskResult> {
    const projectStore = ProjectStore.getInstance();
    const taskStore = TaskStore.getInstance();

    const task = taskStore.getTask(projectId, taskId);
    if (!task) {
      throw new Error(`[Workflow] 后台任务异常: 任务 [${taskId}] 不存在`);
    }

    // 终态核验防御：任务已取消/结束则绝不覆盖执行
    if (task.status !== 'proposed' && task.status !== 'queued' && task.status !== 'running') {
      return {
        success: false,
        task,
        error: `任务处于终态 [${task.status}]，禁止执行！`,
      };
    }

    const targetReg = registration || (task.skill ? this.registrations.get(task.skill) : undefined);
    if (!targetReg) {
      throw new Error(`[Workflow] 未找到任务 [${taskId}] 对应的工序注册`);
    }

    const project = projectStore.getProject(projectId);
    const cleanPayload = { ...(task.payload || {}) };
    const startTime = Date.now();
    const beforeStageKeys = new Set(Object.keys(project?.stageArtifacts || {}));

    try {
      console.log(`[Workflow] 后台开始执行工序: key=${targetReg.key}, project=${projectId}`);
      const userFeedbackText =
        cleanPayload.userPrompt ||
        cleanPayload.feedback ||
        cleanPayload.userFeedback ||
        cleanPayload.reason ||
        task.description;

      const inputData = {
        projectId,
        sessionId: task.sessionId,
        // 双轨执行体分流依据：actionType 是任务顶层字段，若不在此显式透传，
        // 执行体看到的只有 payload，会把 TARGETED_REVISE 误判为标准全量推演（微调轨失效）
        actionType: task.actionType,
        activeStage: (project as any)?.currentStage,
        targetSkill: targetReg.key,
        feedback: userFeedbackText,
        payload: {
          ...cleanPayload,
          actionType: task.actionType,
          taskId,
          targetSkill: targetReg.key,
          skill: targetReg.key,
        },
        overrideParams: overrideParameters,
      };

      const executeFn =
        typeof targetReg.execute === 'function'
          ? targetReg.execute
          : (targetReg.execute as any).execute.bind(targetReg.execute);

      // 底座异步上下文注入：底层工具与封装的 Workflow 自动感知当前 taskId
      const stepOutput = await workflowTaskStorage.run(
        {
          projectId,
          taskId,
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

      // 终态核验防御：若执行期间任务被人为取消，放弃覆盖写入 succeeded
      const latestCheck = taskStore.getTask(projectId, taskId);
      if (latestCheck && latestCheck.status !== 'running') {
        console.warn(`[Workflow] 任务 [${taskId}] 执行中已被修改为 [${latestCheck.status}]，放弃覆盖终态`);
        return {
          success: false,
          task: latestCheck,
          error: `任务已被修改为 [${latestCheck.status}]`,
        };
      }

      // 任务成功：状态、进度、产物链接一次性落在 Task 上
      const resultSummary = stepOutput?.lastSummary || `工序 [${targetReg.key}] 执行成功`;
      const artifacts = this.collectTaskArtifacts(projectId, task, beforeStageKeys, stepOutput, resultSummary);
      const updatedTask = taskStore.setStatus(projectId, taskId, 'succeeded', {
        progress: { current: 100, total: 100, percent: 100, note: resultSummary },
        resultSummary,
        artifacts,
      });

      // 触发业务生命周期流转钩子
      if (targetReg.onSuccess) {
        try {
          await targetReg.onSuccess({
            projectId,
            sessionId: task.sessionId,
            taskId,
            actionType: task.actionType,
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
        const pendingList = taskStore.listTasks(projectId, { status: 'proposed' });
        currentProject.status =
          pendingList.length > 0 ? SessionStatus.WAITING_FOR_INTERVENTION : SessionStatus.IDLE;
        currentProject.updatedAt = new Date().toISOString();
        projectStore.saveProject(currentProject);
      }

      return {
        success: true,
        task: updatedTask || task,
        result: toolResult || stepOutput,
      };
    } catch (err: any) {
      console.error(`[Workflow] 任务 [${taskId}] 执行失败:`, err);
      const latestTask = taskStore.getTask(projectId, taskId);
      if (latestTask && latestTask.status === 'running') {
        taskStore.setStatus(projectId, taskId, 'failed', {
          error: err.message || '执行异常',
        });
        // 只在 running → failed 这一跳播报，重放/重复失败不重复打扰
        this.announceTaskFailure(latestTask, err.message || '执行异常');
      }
      const currentProject = projectStore.getProject(projectId);
      if (currentProject) {
        currentProject.status = SessionStatus.FAILED;
        currentProject.updatedAt = new Date().toISOString();
        projectStore.saveProject(currentProject);
      }
      // 必须在收尾之后再读一次：latestTask 是置 failed 之前的快照，
      // 直接返回它会让调用方拿到 status='running' 的幽灵状态（客户端据此继续轮询永不结束）。
      const settledTask = taskStore.getTask(projectId, taskId) || latestTask || task;
      return {
        success: false,
        task: settledTask,
        error: err.message,
      };
    }
  }

  /**
   * 汇总本任务真实产出的产物链接：
   * 1. 本次执行新增的工序产物（首次落盘）；
   * 2. 修改轨上报 changedStages 命中的既有产物（覆盖写）；
   * 3. 任务显式涉及的工序（stages 命中已有产物键位时）。
   * 质检报告类键位（critic_review_* 与 criticReports）不进入产物清单。
   */
  private collectTaskArtifacts(
    projectId: string,
    task: Task,
    beforeStageKeys: Set<string>,
    stepOutput: any,
    resultSummary?: string
  ): TaskArtifact[] {
    const project = ProjectStore.getInstance().getProject(projectId);
    const artifacts = project?.stageArtifacts || {};
    const keys = Object.keys(artifacts).filter(
      (k) => artifacts[k] && !isCriticReportKey(k)
    );

    const produced = new Set<string>();
    for (const key of keys) {
      if (!beforeStageKeys.has(key)) produced.add(key);
    }

    const changed: string[] = Array.isArray(stepOutput?.changedStages) ? stepOutput.changedStages : [];
    for (const stage of changed) {
      if (keys.includes(stage)) produced.add(stage);
    }
    for (const stage of task.stages || []) {
      if (keys.includes(stage)) produced.add(stage);
    }

    const now = new Date().toISOString();
    return Array.from(produced).map((stage) => ({
      stage,
      kind: 'stage-artifact',
      url: `/api/projects/${projectId}/artifacts/${stage}`,
      summary: resultSummary,
      createdAt: now,
    }));
  }

  /**
   * 同步执行任务（供自动化测试或同步调用端使用）
   */
  public async executeTask(options: ExecuteTaskOptions): Promise<ExecuteTaskResult> {
    const { taskId } = options;
    await this.startTask(options);
    // 排队中的任务也可能还没拿到执行位，必须等它在链上的真实结果，
    // 否则调用方拿到的是「queued」快照并误判为失败
    const pending = this.scheduledPromises.get(taskId) || this.activeTasks.get(taskId);
    if (pending) {
      return await pending;
    }
    const current = TaskStore.getInstance().getTask(options.projectId, taskId);
    return {
      success: current?.status === 'succeeded',
      task: current!,
      error: current?.error,
    };
  }

  /**
   * 创作者主动取消（驳回）任务
   */
  public async cancelTask(projectId: string, taskId: string, reason?: string): Promise<Task> {
    const lock = ProjectLockManager.getInstance();
    return lock.withLock(projectId, async () => {
      const taskStore = TaskStore.getInstance();
      const current = taskStore.getTask(projectId, taskId);
      if (!current) {
        throw new Error(`[Workflow] 任务 ${taskId} 不存在`);
      }
      if (current.status === 'running' || this.activeTasks.has(taskId)) {
        const err = new Error(`任务 ${taskId} 正在执行中，不可取消`);
        (err as any).statusCode = 409;
        throw err;
      }
      const cancelled = taskStore.cancelTask(projectId, taskId, reason || '创作者主动驳回');
      if (!cancelled) {
        throw new Error(`[Workflow] 任务 ${taskId} 更新失败`);
      }
      return cancelled;
    });
  }

  /**
   * 孤儿任务自愈扫描
   *
   * 执行队列只存在于内存，进程重启后没人会来消费，因此两种状态都必须收口：
   * - running：执行到一半进程没了，置 failed 并提示重试；
   * - queued：批过了但还没轮到就被重启打断，同样永远等不到执行，
   *   若留在 queued，客户端会按「排队中」无限轮询（这条以前是漏的）。
   */
  public recoverOrphanTasks(): void {
    try {
      const projectStore = ProjectStore.getInstance();
      const taskStore = TaskStore.getInstance();
      const projects = projectStore.listProjects();

      for (const p of projects) {
        const orphans = [
          ...taskStore.listTasks(p.projectId, { status: 'running' }),
          ...taskStore.listTasks(p.projectId, { status: 'queued' }),
        ];
        for (const orphan of orphans) {
          const wasRunning = orphan.status === 'running';
          console.warn(
            `[Workflow] 检测到中断的孤儿任务 [${orphan.taskId}](${orphan.status})，自动恢复为 failed...`
          );
          taskStore.setStatus(p.projectId, orphan.taskId, 'failed', {
            error: wasRunning
              ? '系统进程异常重启，任务已自动置为失败'
              : '系统进程异常重启，排队中的任务未能执行，请重试',
          });
        }
      }
    } catch (err) {
      console.warn('[Workflow] 孤儿自愈扫描告警:', err);
    }
  }
}
