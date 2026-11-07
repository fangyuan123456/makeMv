/**
 * utils/concurrency.ts
 * 异步并发控制基础设施 (SSOT)
 */

import { getCurrentTaskContext } from '../workflow-engine/WorkflowContextStorage.js';
import { TaskStore } from '../project-store/TaskStore.js';

/**
 * 底座级任务进度自动广播辅助函数 (Zero-Touch Infrastructure)
 */
function broadcastTaskProgress(completed: number, total: number): void {
  try {
    const taskCtx = getCurrentTaskContext();
    if (taskCtx && total > 0) {
      const percent = Math.min(95, Math.max(5, Math.round((completed / total) * 90) + 5));
      TaskStore.getInstance().patchTask(taskCtx.projectId, taskCtx.taskId, {
        status: 'running',
        progress: { current: completed, total, percent },
      });
    }
  } catch (err) {
    // 基础设施静默容错，杜绝进度广播影响物理计算主链路
  }
}

/**
 * 异步并发池：对数组元素执行受限并发的异步任务。
 * 严格保持返回结果数组与原始输入项的顺序一一对应。
 * 支持 AbortSignal 及时取消与异常发生时的快速短路中断。
 */
export async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  taskFn: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number, result: R) => void,
  abortSignal?: AbortSignal
): Promise<R[]> {
  const total = items.length;
  if (total === 0) return [];

  if (abortSignal?.aborted) {
    throw new Error('异步并发任务已被提前取消');
  }

  const results: R[] = new Array(total);
  const limit = Math.max(1, Math.min(concurrency, total));

  let currentIndex = 0;
  let completedCount = 0;
  let hasError = false;

  // 底座自动广播并发初始进度
  broadcastTaskProgress(0, total);

  async function worker(): Promise<void> {
    while (currentIndex < total && !hasError) {
      if (abortSignal?.aborted) {
        hasError = true;
        throw new Error('异步并发任务执行中已被中断取消');
      }

      const index = currentIndex++;
      const item = items[index];

      try {
        const result = await taskFn(item, index);
        results[index] = result;
        completedCount++;

        // 底座自动广播单步完成进度
        broadcastTaskProgress(completedCount, total);

        if (onProgress) {
          onProgress(completedCount, total, result);
        }
      } catch (err) {
        hasError = true;
        throw err;
      }
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);

  return results;
}

export interface PoolSettledResult<R> {
  status: 'fulfilled' | 'rejected';
  value?: R;
  reason?: any;
  index: number;
}

/**
 * 容错并发池 (Fault-Tolerant Concurrent Pool)：
 * 单个任务失败不破坏已成功产物，全量收集成功项与失败项，实现“部分成功保全”
 */
export async function asyncPoolSettled<T, R>(
  concurrency: number,
  items: T[],
  taskFn: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number, result?: R, error?: any) => void,
  abortSignal?: AbortSignal
): Promise<PoolSettledResult<R>[]> {
  const total = items.length;
  if (total === 0) return [];

  const results: PoolSettledResult<R>[] = new Array(total);
  const limit = Math.max(1, Math.min(concurrency, total));

  let currentIndex = 0;
  let completedCount = 0;

  // 底座自动广播并发初始进度
  broadcastTaskProgress(0, total);

  async function worker(): Promise<void> {
    while (currentIndex < total) {
      if (abortSignal?.aborted) {
        break;
      }

      const index = currentIndex++;
      const item = items[index];

      try {
        const result = await taskFn(item, index);
        results[index] = { status: 'fulfilled', value: result, index };
        completedCount++;

        // 底座自动广播单步完成进度
        broadcastTaskProgress(completedCount, total);

        if (onProgress) onProgress(completedCount, total, result, undefined);
      } catch (err) {
        results[index] = { status: 'rejected', reason: err, index };
        completedCount++;

        // 底座自动广播单步完成进度
        broadcastTaskProgress(completedCount, total);

        if (onProgress) onProgress(completedCount, total, undefined, err);
      }
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);

  return results;
}
