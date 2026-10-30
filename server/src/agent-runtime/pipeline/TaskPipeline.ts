/**
 * agent-runtime/pipeline/TaskPipeline.ts
 * 通用宏观 Task 流水线 (面向顶层多智能体协同与工程步骤的声明式编排执行机)
 *
 * 核心机制：
 * 1. 宏观组织各个专业 Agent 与多工种并发协同；
 * 2. 纯数据流驱动，0 上下文传递；
 * 3. 继承 Pipeline 统一的可观测性、耗时度量与受控并发保护。
 */

import { Pipeline } from './Pipeline.js';
import type { PipelineStep } from './PipelineStep.js';
import type { ParallelStepOptions } from './ParallelStep.js';

export interface AgentTaskRunner {
  readonly name: string;
  run(input?: any): Promise<any>;
}

class FunctionalTaskStep implements PipelineStep {
  constructor(
    public readonly name: string,
    private readonly runner: (input?: any) => Promise<any>,
  ) {}

  public async run(input?: any): Promise<any> {
    return this.runner(input);
  }
}

export class TaskPipeline extends Pipeline {
  constructor(name: string = 'TaskPipeline', projectId?: string) {
    super(name, projectId);
  }

  public override addStep(
    stepOrName: PipelineStep | string,
    stepFn?: (input?: any) => Promise<any> | any,
  ): this {
    if (typeof stepOrName === 'string') {
      if (!stepFn) throw new Error(`[TaskPipeline] 缺少步骤执行函数: ${stepOrName}`);
      super.addStep(new FunctionalTaskStep(stepOrName, stepFn));
      return this;
    }
    super.addStep(stepOrName);
    return this;
  }

  /**
   * 追加单个 Agent 执行工序
   */
  public addAgent(
    nameOrRunner: string | AgentTaskRunner,
    runnerFn?: (input?: any) => Promise<any>,
  ): this {
    if (typeof nameOrRunner === 'string') {
      if (!runnerFn) throw new Error(`[TaskPipeline] 缺少执行函数: ${nameOrRunner}`);
      this.addStep(new FunctionalTaskStep(nameOrRunner, runnerFn));
    } else {
      this.addStep(new FunctionalTaskStep(nameOrRunner.name, (input) => nameOrRunner.run(input)));
    }
    return this;
  }

  /**
   * 追加多个 Agent 并行协同步骤组 (Multi-Agent Concurrency)
   * 支持 options 控制最大并发路数 (concurrency) 与组名称
   */
  public addParallelAgents(
    agents: Array<{ name: string; run: (input?: any) => Promise<any> }>,
    options?: string | ParallelStepOptions,
  ): this {
    const steps = agents.map((a) => new FunctionalTaskStep(a.name, a.run));
    const defaultGroup = `ParallelAgents[${agents.map((a) => a.name).join(' || ')}]`;

    if (typeof options === 'string') {
      this.addParallel(steps, { name: options || defaultGroup });
    } else {
      this.addParallel(steps, {
        name: options?.name || defaultGroup,
        concurrency: options?.concurrency,
        onStepComplete: options?.onStepComplete,
      });
    }

    return this;
  }
}
