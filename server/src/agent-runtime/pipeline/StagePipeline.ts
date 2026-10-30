/**
 * agent-runtime/pipeline/StagePipeline.ts
 * 通用微观 Stage 流水线引擎 (纯数据输入输出)
 *
 * 核心机制：
 * 原生接收与绑定 projectId，自动将其注入每一个添加的 Stage，
 * 消除业务 Stage 间数据透传 projectId 的必要性。
 */

import { Pipeline } from './Pipeline.js';
import type { PipelineStep } from './PipelineStep.js';
import type { ParallelStepOptions } from './ParallelStep.js';

export interface IStageExecutable {
  readonly name: string;
  setProjectId?(projectId: string): this;
  execute(input?: any): Promise<any>;
}

class StageStepAdapter implements PipelineStep {
  public readonly name: string;

  constructor(private readonly stage: IStageExecutable) {
    this.name = stage.name;
  }

  public async run(input?: any): Promise<any> {
    return this.stage.execute(input);
  }
}

export class StagePipeline extends Pipeline {
  constructor(name: string = 'StagePipeline', projectId?: string) {
    super(name, projectId);
  }

  public addStage(stage: IStageExecutable): this {
    if (this.projectId && typeof stage.setProjectId === 'function') {
      stage.setProjectId(this.projectId);
    }
    this.addStep(new StageStepAdapter(stage));
    return this;
  }

  public addParallelStages(stages: IStageExecutable[], options?: string | ParallelStepOptions): this {
    const steps = stages.map((s) => {
      if (this.projectId && typeof s.setProjectId === 'function') {
        s.setProjectId(this.projectId);
      }
      return new StageStepAdapter(s);
    });
    this.addParallel(steps, options);
    return this;
  }
}
