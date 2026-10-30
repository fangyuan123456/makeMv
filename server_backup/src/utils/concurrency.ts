/**
 * 异步并发池：对数组元素执行受限并发的异步任务。
 * 严格保持返回结果数组与原始输入项的顺序一一对应。
 */
export async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  taskFn: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number, result: R) => void
): Promise<R[]> {
  const total = items.length;
  if (total === 0) return [];

  const results: R[] = new Array(total);
  const limit = Math.max(1, Math.min(concurrency, total));

  let currentIndex = 0;
  let completedCount = 0;

  async function worker(): Promise<void> {
    while (currentIndex < total) {
      const index = currentIndex++;
      const item = items[index];

      const result = await taskFn(item, index);
      results[index] = result;
      completedCount++;

      if (onProgress) {
        onProgress(completedCount, total, result);
      }
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);

  return results;
}

/**
 * 分区异步互斥锁（Mutex）管理器。
 * 确保同一键（如特定 sessionId）的任务按序串行执行，
 * 同时不同键的任务彼此独立并发运行，互不阻塞。
 */
export class KeyedAsyncLock {
  private queues: Map<string, Promise<any>> = new Map();

  async acquire<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) || Promise.resolve();

    let resolveNext: () => void;
    const currentPromise = new Promise<void>((resolve) => {
      resolveNext = resolve;
    });

    // 链接至前一个任务的 Promise 链条
    const executePromise = prev
      .catch(() => {}) // 捕获异常，防止前置任务失败导致后续任务永久挂起
      .then(async () => {
        try {
          return await task();
        } finally {
          resolveNext();
          if (this.queues.get(key) === currentPromise) {
            this.queues.delete(key);
          }
        }
      });

    this.queues.set(key, currentPromise);
    return executePromise;
  }
}

export const sessionLock = new KeyedAsyncLock();
