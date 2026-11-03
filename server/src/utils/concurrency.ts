/**
 * utils/concurrency.ts
 * 异步并发控制基础设施 (SSOT)
 */

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
 * 🌟 容错并发池 (Fault-Tolerant Concurrent Pool)：
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
        if (onProgress) onProgress(completedCount, total, result, undefined);
      } catch (err) {
        results[index] = { status: 'rejected', reason: err, index };
        completedCount++;
        if (onProgress) onProgress(completedCount, total, undefined, err);
      }
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);

  return results;
}
