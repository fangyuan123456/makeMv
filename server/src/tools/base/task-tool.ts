/**
 * tools/base/task-tool.ts
 * 通用任务工具抽象基类 (Base Task Tool SSOT)
 *
 * 核心机制：
 * 1. 两次回调规范：
 *    - 第一次回调 onTaskId：任务认领即刻触发，交付语义化 taskId 给调用方；
 *    - 第二次回调 onResult：内部 Workflow 执行完成后异步触发，交付终态结果或错误；
 * 2. 内部结构：采用 Mastra 微内核原生的 Workflow 与 Step 设计，具备完整的步骤追踪与状态自洽；
 * 3. 工具组合 (Tool Composition)：支持父工具通过 callSubTool 安全嵌套调用子工具，自动维护父子任务追踪。
 */

import { EventEmitter } from 'events';
import type { Workflow } from '@mastra/core/workflows';

/**
 * 任务工具双阶段回调契约
 */
export interface TaskToolCallbacks<TOutput> {
  /**
   * ⚡ 第一次回调：任务派发/认领时立即触发，交付 taskId
   */
  onTaskId: (taskId: string) => void | Promise<void>;

  /**
   * 🎯 第二次回调：内部工作流完全执行完毕后触发，交付终态结果或异常
   */
  onResult: (result: TaskResult<TOutput>) => void | Promise<void>;

  /**
   * (可选) 中间过程进度上报
   */
  onProgress?: (progress: { percent: number; note: string }) => void | Promise<void>;
}

/**
 * 任务终态结果载荷
 */
export interface TaskResult<TOutput> {
  taskId: string;
  toolName: string;
  success: boolean;
  data?: TOutput;
  error?: string;
  durationMs: number;
}

/**
 * 任务执行上下文 (透传给内部 Workflow 和 Step)
 */
export interface TaskExecutionContext {
  taskId: string;
  toolName: string;
  parentTaskId?: string;
  abortSignal?: AbortSignal;
  reportProgress: (percent: number, note: string) => void;
}

/**
 * 任务调度选项
 */
export interface TaskDispatchOptions {
  customTaskId?: string;
  parentTaskId?: string;
  abortSignal?: AbortSignal;
}

/**
 * 通用任务工具抽象基类
 */
export abstract class BaseTaskTool<TInput, TOutput> extends EventEmitter {
  /** 工具唯一标识符 (如 "planner.screenplay_writer") */
  public abstract readonly toolName: string;

  /** 工具业务描述 */
  public abstract readonly description: string;

  /**
   * 子类实现：构建内部执行的 Mastra Workflow (使用 Step 设计)
   */
  protected abstract buildWorkflow(): Workflow<any, any>;

  /**
   * 生成全局唯一的语义化任务 ID
   */
  protected generateTaskId(parentTaskId?: string): string {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 6);
    const sanitizedName = this.toolName.replace(/\./g, '_');
    return parentTaskId
      ? `task_${sanitizedName}_sub_${timestamp}_${rand}`
      : `task_${sanitizedName}_${timestamp}_${rand}`;
  }

  /**
   * 核心派发入口：监听/接收任务执行，刚性分两次回调
   */
  public async dispatch(
    input: TInput,
    callbacks: TaskToolCallbacks<TOutput>,
    options?: TaskDispatchOptions
  ): Promise<string> {
    const taskId = options?.customTaskId || this.generateTaskId(options?.parentTaskId);
    const startTime = Date.now();

    // -------------------------------------------------------------
    // ⚡ 第一次回调：立即认领任务，派发 taskId 给调用方 / 前端进行槽位挂载
    // -------------------------------------------------------------
    try {
      await callbacks.onTaskId(taskId);
      this.emit('task:accepted', { taskId, toolName: this.toolName, input });
    } catch (cbErr: any) {
      console.error(`[${this.toolName}] 第一次回调 onTaskId 异常:`, cbErr);
    }

    // -------------------------------------------------------------
    // 异步执行内部 Workflow (基于 Step 编排)
    // -------------------------------------------------------------
    (async () => {
      let isExecutionSuccess = false;
      let finalResultPayload: TaskResult<TOutput> | null = null;

      try {
        // 刚性取消预检
        if (options?.abortSignal?.aborted) {
          throw new Error(`[${this.toolName}] 任务已被外部中止 (Aborted)`);
        }

        const context: TaskExecutionContext = {
          taskId,
          toolName: this.toolName,
          parentTaskId: options?.parentTaskId,
          abortSignal: options?.abortSignal,
          reportProgress: (percent, note) => {
            try {
              callbacks.onProgress?.({ percent, note });
            } catch (pErr: any) {
              console.error(`[${this.toolName}] onProgress 回调异常:`, pErr);
            }
            this.emit('task:progress', { taskId, percent, note });
          },
        };

        // 1. 实例化内部 Workflow
        const workflow = this.buildWorkflow();

        // 2. 启动执行并透传 input 与 context (同时兼容 Mastra triggerData 与 inputData)
        const run = workflow.createRun();
        const payload = {
          ...input,
          _context: context,
        };
        const runResult = await run.start({
          triggerData: payload,
          inputData: payload,
        } as any);

        // 3. 提取执行结果：兼容 Mastra Workflow 原生 runResult (results[stepId].output) 与直接结果结构
        let finalData: any = runResult;
        if (runResult && typeof runResult === 'object') {
          if ((runResult as any).result !== undefined) {
            finalData = (runResult as any).result;
          } else if ((runResult as any).results && typeof (runResult as any).results === 'object') {
            const resultsObj = (runResult as any).results;
            const stepKeys = Object.keys(resultsObj);
            if (stepKeys.length > 0) {
              // 刚性遍历每个工序，若有任何中间工序失败，立即阻断
              for (const key of stepKeys) {
                const stepRes = resultsObj[key];
                if (stepRes?.status === 'failed') {
                  throw new Error(stepRes.error || `工序步骤 [${key}] 执行失败`);
                }
              }
              const lastKey = stepKeys[stepKeys.length - 1];
              const stepResult = resultsObj[lastKey];
              finalData = stepResult?.output !== undefined ? stepResult.output : stepResult;
            }
          }
        }

        // 4. 业务级刚性校验：绝不允许内部带着 success: false 的脏数据伪装成成功结果
        if (finalData && typeof finalData === 'object' && (finalData as any).success === false) {
          throw new Error((finalData as any).error || `[${this.toolName}] 内部工序执行返回失败标记`);
        }

        const durationMs = Date.now() - startTime;
        finalResultPayload = {
          taskId,
          toolName: this.toolName,
          success: true,
          data: finalData,
          durationMs,
        };
        isExecutionSuccess = true;
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        finalResultPayload = {
          taskId,
          toolName: this.toolName,
          success: false,
          error: err?.message || String(err),
          durationMs,
        };
        isExecutionSuccess = false;
      }

      // -------------------------------------------------------------
      // 🎯 第二次回调：执行完成，正交交付给调用方（防御外部回调异常污染工具状态）
      // -------------------------------------------------------------
      if (finalResultPayload) {
        try {
          await callbacks.onResult(finalResultPayload);
        } catch (cbErr: any) {
          console.error(
            `[${this.toolName}] 第二次回调 onResult 交付异常 (调用方代码抛出):`,
            cbErr
          );
        }

        if (isExecutionSuccess) {
          this.emit('task:completed', finalResultPayload);
        } else {
          this.emit('task:failed', finalResultPayload);
        }
      }
    })().catch((unhandledErr) => {
      console.error(`[${this.toolName}] 内部异步派发发生严重未捕获异常:`, unhandledErr);
    });

    // 调度方法同步返回 taskId
    return taskId;
  }

  /**
   * 工具调用工具 (Tool Composition)：父工具安全嵌套调用子工具
   */
  public async callSubTool<SubInput, SubOutput>(
    subTool: BaseTaskTool<SubInput, SubOutput>,
    subInput: SubInput,
    currentContext: TaskExecutionContext,
    subCallbacks?: Partial<TaskToolCallbacks<SubOutput>>
  ): Promise<SubOutput> {
    return new Promise((resolve, reject) => {
      subTool.dispatch(
        subInput,
        {
          onTaskId: async (subTaskId) => {
            if (subCallbacks?.onTaskId) {
              await subCallbacks.onTaskId(subTaskId);
            }
          },
          onResult: async (result) => {
            if (subCallbacks?.onResult) {
              await subCallbacks.onResult(result);
            }
            if (result.success && result.data !== undefined) {
              resolve(result.data);
            } else {
              reject(new Error(`[${subTool.toolName}] 子工具执行失败: ${result.error}`));
            }
          },
          onProgress: subCallbacks?.onProgress,
        },
        {
          parentTaskId: currentContext.taskId,
          abortSignal: currentContext.abortSignal,
        }
      );
    });
  }
}
