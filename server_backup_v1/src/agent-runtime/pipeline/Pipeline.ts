/**
 * agent-runtime/pipeline/Pipeline.ts
 * 通用声明式流水线引擎 (Declarative Pipeline Engine)
 *
 * 核心特性：
 * 1. 链式声明组装 (addStep, addParallel)
 * 2. 纯数据流驱动 (Data In, Data Out)，0 框架元数据侵入
 * 3. 原生持有 projectId，彻底免除在步骤产物间反向回填或透传 projectId
 * 4. 实时响应 JobAbortRegistry 中断信号，毫秒级掐断后续工序，避免算力与 Token 浪费
 * 5. 步骤弹性重试与退避机制 (RetryPolicy)，自愈第三方网络抖动
 */

import type { PipelineStep, RetryPolicy } from './PipelineStep.js';
import { ParallelStep, type ParallelStepOptions } from './ParallelStep.js';
import { ProgressBus, JobAbortRegistry } from '../bus/index.js';


export class PipelineAbortError extends Error {
  constructor(message: string = '流水线已被外部信号主动中断') {
    super(message);
    this.name = 'PipelineAbortError';
  }
}

export interface PipelineExecutionReport {
  pipelineName: string;
  success: boolean;
  durationMs: number;
  stepDurations: Record<string, number>;
  output?: any;
  error?: string;
}

export class Pipeline {
  protected readonly steps: PipelineStep[] = [];
  public projectId?: string;

  constructor(
    public readonly name: string = 'Pipeline',
    projectId?: string,
  ) {
    this.projectId = projectId;
  }

  public setProjectId(projectId: string): this {
    this.projectId = projectId;
    return this;
  }

  /**
   * 追加串行执行步骤
   */
  public addStep(step: PipelineStep): this {
    this.steps.push(step);
    return this;
  }

  /**
   * 追加并行执行步骤组 (支持受控并发度 options)
   */
  public addParallel(steps: PipelineStep[], options?: string | ParallelStepOptions): this {
    this.steps.push(new ParallelStep(steps, options));
    return this;
  }

  /**
   * 获取所有注册步骤列表
   */
  public getSteps(): readonly PipelineStep[] {
    return this.steps;
  }

  /**
   * 带弹性重试与退避的单步执行器
   */
  private async executeStepWithRetry(
    step: PipelineStep,
    input: any,
    activeProjectId?: string,
  ): Promise<any> {
    const retry = step.retry;
    const maxRetries = retry?.maxRetries ?? 0;
    const baseBackoff = retry?.backoffMs ?? 1000;
    const exponential = retry?.exponential !== false;

    let attempt = 0;
    while (true) {
      if (
        (activeProjectId && JobAbortRegistry.get(activeProjectId)?.signal.aborted) ||
        (input && typeof input === 'object' && input.abortSignal?.aborted)
      ) {
        throw new PipelineAbortError(`流水线 [${this.name}] 已被主动中断`);
      }

      try {
        return await step.run(input);
      } catch (err: any) {
        if (err instanceof PipelineAbortError || err.name === 'AbortError') {
          throw err;
        }
        attempt++;
        if (attempt > maxRetries) {
          throw err;
        }
        const delay = exponential ? baseBackoff * Math.pow(2, attempt - 1) : baseBackoff;
        console.warn(
          `[Pipeline] ⚠️ 步骤 [${step.name}] 执行异常: ${err.message}。将在 ${delay}ms 后进行第 ${attempt}/${maxRetries} 次重试...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * 启动流水线顺序执行 (纯数据输入输出)
   */
  public async run(initialInput?: any): Promise<any> {
    const activeProjectId =
      this.projectId || (initialInput && typeof initialInput === 'object' ? initialInput.projectId : undefined);

    const totalStart = Date.now();
    const stepDurations: Record<string, number> = {};
    let lastOutput = initialInput;

    console.log(`\n${'═'.repeat(64)}`);
    console.log(`[Pipeline] 🚀 启动流水线: [${this.name}] (包含 ${this.steps.length} 个步骤)`);
    console.log(`${'═'.repeat(64)}`);

    let stepIdx = 0;
    for (const step of this.steps) {
      stepIdx++;
      const stepStart = Date.now();
      const stepLabel = step.name;

      // 1. 每步执行前主动嗅探工程中断信号 (Abort Propagation)
      if (activeProjectId) {
        const controller = JobAbortRegistry.get(activeProjectId);
        const isCustomAborted = initialInput && typeof initialInput === 'object' && initialInput.abortSignal?.aborted;
        if (controller?.signal.aborted || isCustomAborted) {
          console.warn(`\n[Pipeline] 🛑 检测到工程 ${activeProjectId} 已被外部中断，终止流水线`);
          ProgressBus.getInstance().emitProgress({
            projectId: activeProjectId,
            stage: 'ABORTED',
            detail: `流水线 [${this.name}] 已被用户主动中断`,
            percent: Math.round(((stepIdx - 1) / this.steps.length) * 100),
            timestamp: new Date().toISOString(),
          });
          throw new PipelineAbortError(`流水线 [${this.name}] 已被主动中断`);
        }
      }

      const borderLen = Math.max(2, 46 - stepLabel.length);
      console.log(`\n┌─── ▶ 启动步骤: [${stepLabel}] ${'─'.repeat(borderLen)}`);

      try {
        if (activeProjectId) {
          ProgressBus.getInstance().emitProgress({
            projectId: activeProjectId,
            stage: stepLabel,
            detail: `执行流水线 [${this.name}] 步骤: ${stepLabel}`,
            percent: Math.round((stepIdx / this.steps.length) * 100),
            timestamp: new Date().toISOString(),
          });
        }

        // 2. 执行单步 (内含弹性重试与中断嗅探)
        lastOutput = await this.executeStepWithRetry(step, lastOutput, activeProjectId);
        const duration = Date.now() - stepStart;
        stepDurations[stepLabel] = duration;

        const endBorderLen = Math.max(2, 38 - stepLabel.length);
        console.log(
          `└─── ✔ 步骤完成: [${stepLabel}] (耗时: ${(duration / 1000).toFixed(2)}s) ${'─'.repeat(endBorderLen)}\n`,
        );
      } catch (err: any) {
        const duration = Date.now() - stepStart;

        if (err instanceof PipelineAbortError || err.name === 'AbortError') {
          console.warn(`\n🛑 [Pipeline] 步骤 [${stepLabel}] 因中断信号退出 (耗时: ${(duration / 1000).toFixed(2)}s)`);
          throw err;
        }

        console.error(`\n✖ [Pipeline] 步骤 [${stepLabel}] 执行失败 (耗时: ${(duration / 1000).toFixed(2)}s):`, err);

        if (activeProjectId) {
          ProgressBus.getInstance().emitProgress({
            projectId: activeProjectId,
            stage: 'ERROR',
            detail: `步骤 [${stepLabel}] 失败: ${err.message}`,
            percent: Math.round((stepIdx / this.steps.length) * 100),
            timestamp: new Date().toISOString(),
          });
        }
        throw err;
      }
    }

    const totalDuration = Date.now() - totalStart;
    console.log(`\n${'═'.repeat(64)}`);
    console.log(`[Pipeline] 🎉 流水线 [${this.name}] 执行完毕 (总耗时: ${(totalDuration / 1000).toFixed(2)}s)`);
    console.log(`${'═'.repeat(64)}\n`);

    return lastOutput;
  }
}
