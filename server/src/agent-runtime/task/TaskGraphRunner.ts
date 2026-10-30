/**
 * agent-runtime/task/TaskGraphRunner.ts
 * 通用 DAG 动态可变任务拓扑图全自动并发执行机 (TaskGraphRunner SSOT)
 *
 * 核心特性：
 * 1. 自动循环检测图收敛状态；
 * 2. 批量拉取就绪任务（readyBatch），利用 asyncPool 受限并发池并发执行；
 * 3. 实时响应 JobAbortRegistry 中断信号；
 * 4. 任务失败自动重试、超限标记失败并跳过依赖下游；
 * 5. 自动死锁侦测与完工报告生成。
 */

import { TaskGraph } from './TaskGraph.js';
import type {
  TaskNode,
  TaskGraphSnapshot,
  TaskExecuteFn,
  TaskGraphRunnerOptions,
} from './types.js';
import { asyncPool } from '../../utils/concurrency.js';
import { JobAbortRegistry } from '../../queue/JobAbortRegistry.js';
import { PipelineAbortError } from '../pipeline/Pipeline.js';

export class TaskGraphRunner<TPayload = Record<string, unknown>, TResult = any> {
  private readonly concurrency: number;
  private readonly stopOnError: boolean;

  constructor(
    private readonly graph: TaskGraph<TPayload>,
    private readonly options?: TaskGraphRunnerOptions<TPayload, TResult>,
  ) {
    this.concurrency = Math.max(1, options?.concurrency || 3);
    this.stopOnError = options?.stopOnError !== false;
  }

  /**
   * 启动 DAG 全自动并发调度执行闭环
   */
  public async run(executor: TaskExecuteFn<TPayload, TResult>): Promise<TaskGraphSnapshot<TPayload>> {
    const projectId = this.graph.projectId;

    while (!this.graph.isComplete()) {
      // 1. 嗅探中断信号 (Abort Check)
      if (projectId && JobAbortRegistry.get(projectId)?.signal.aborted) {
        throw new PipelineAbortError(`TaskGraph 执行已被主动中断 (projectId: ${projectId})`);
      }

      // 2. 获取当前依赖已满足的就绪任务批次
      const readyBatch = this.graph.getReadyBatch();

      if (readyBatch.length === 0) {
        // 如果图尚未完工但已无任何就绪任务，说明前置依赖失败导致下游全部被跳过，或存在不可达死锁
        if (this.graph.hasFailed()) {
          console.warn(`[TaskGraphRunner] 图中存在失败节点，剩余任务已阻断收敛`);
          break;
        }
        throw new Error(`[TaskGraphRunner] 检测到调度死锁：任务图未完工但无任何可就绪节点`);
      }

      // 3. 使用受限并发池并发驱动当前批次节点
      await asyncPool(this.concurrency, readyBatch, async (node: TaskNode<TPayload>) => {
        // 单任务前再次核实中断
        if (projectId && JobAbortRegistry.get(projectId)?.signal.aborted) {
          throw new PipelineAbortError(`TaskGraph 任务已被中断`);
        }

        this.graph.markActive(node.id);
        this.options?.onTaskStart?.(node);

        try {
          const result = await executor(node);
          this.graph.markCompleted(node.id);
          this.options?.onTaskSuccess?.(node, result);
        } catch (err: any) {
          this.options?.onTaskFail?.(node, err);

          if (err instanceof PipelineAbortError || err.name === 'AbortError') {
            throw err;
          }

          // 自动重试判定
          const canRetry = this.graph.incrementRetry(node.id);
          if (!canRetry) {
            console.error(`[TaskGraphRunner] 任务 [${node.id}] (${node.type}) 超过最大重试次数，标记失败: ${err.message}`);
            this.graph.markFailed(node.id, err.message);

            if (this.stopOnError) {
              throw err;
            }
          } else {
            console.warn(
              `[TaskGraphRunner] 任务 [${node.id}] 执行异常: ${err.message}，重试中 (${node.retryCount}/${node.maxRetries})...`,
            );
          }
        }
      });
    }

    return this.graph.snapshot();
  }
}
