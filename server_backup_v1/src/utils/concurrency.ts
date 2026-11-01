/**
 * utils/concurrency.ts
 * 异步并发控制基础设施 (SSOT)
 */

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
