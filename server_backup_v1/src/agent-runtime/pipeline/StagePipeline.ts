/**
 * agent-runtime/pipeline/StagePipeline.ts
 * 业务阶段流水线引擎 (Stage Pipeline Engine)
 *
 * 核心机制：
 * 负责装配并执行某个业务阶段（WorkflowStage）下的所有工步（BaseStep）。
 * 原生接收与绑定 projectId，自动将其注入每一个添加的 Step。
 */

import { Pipeline } from './Pipeline.js';
import type { PipelineStep } from './PipelineStep.js';
import type { ParallelStepOptions } from './ParallelStep.js';

export interface IStepExecutable {
  readonly name: string;
  setProjectId?(projectId: string): this;
  execute(input?: any): Promise<any>;
}

export type ContextStepRunner<TContext = any, TOutput = any> = (ctx: TContext) => Promise<TOutput>;

class ContextStepAdapter<TContext extends Record<string, any>> implements PipelineStep {
  public readonly name: string;

  constructor(
    name: string,
    private readonly outputKey: string | undefined,
    private readonly runner: ContextStepRunner<TContext>,
  ) {
    this.name = name;
  }

  public async run(ctx: TContext): Promise<TContext> {
    const output = await this.runner(ctx);
    if (this.outputKey && ctx && typeof ctx === 'object') {
      (ctx as any)[this.outputKey] = output;
    }
    return ctx;
  }
}

class StepAdapter implements PipelineStep {
  public readonly name: string;

  constructor(private readonly step: IStepExecutable) {
    this.name = step.name;
  }

  public async run(input?: any): Promise<any> {
    return this.step.execute(input);
  }
}

export class StagePipeline extends Pipeline {
  private readonly stepInstances: IStepExecutable[] = [];

  constructor(name: string = 'StagePipeline', projectId?: string) {
    super(name, projectId);
  }

  public override setProjectId(projectId: string): this {
    super.setProjectId(projectId);
    for (const step of this.stepInstances) {
      if (typeof step.setProjectId === 'function') {
        step.setProjectId(projectId);
      }
    }
    return this;
  }

  /** 添加工步 (Step) */
  public override addStep(step: PipelineStep | IStepExecutable): this {
    if ('execute' in step && typeof (step as any).execute === 'function') {
      const execStep = step as IStepExecutable;
      this.stepInstances.push(execStep);
      if (this.projectId && typeof execStep.setProjectId === 'function') {
        execStep.setProjectId(this.projectId);
      }
      super.addStep(new StepAdapter(execStep));
    } else {
      super.addStep(step as PipelineStep);
    }
    return this;
  }

  /**
   * 注册上下文数据流工步 (Context Step)
   * 自动将上游累加的 context 传入 runner，执行完毕后将产物写回 context[outputKey]
   */
  public addContextStep(
    name: string,
    outputKey: string | undefined,
    runner: (ctx: any) => Promise<any>,
  ): this {
    super.addStep(new ContextStepAdapter(name, outputKey, runner));
    return this;
  }

  public addParallelSteps(steps: (PipelineStep | IStepExecutable)[], options?: string | ParallelStepOptions): this {
    const adaptedSteps = steps.map((s) => {
      if ('execute' in s && typeof (s as any).execute === 'function') {
        const execStep = s as IStepExecutable;
        this.stepInstances.push(execStep);
        if (this.projectId && typeof execStep.setProjectId === 'function') {
          execStep.setProjectId(this.projectId);
        }
        return new StepAdapter(execStep);
      }
      return s as PipelineStep;
    });
    this.addParallel(adaptedSteps, options);
    return this;
  }
}
