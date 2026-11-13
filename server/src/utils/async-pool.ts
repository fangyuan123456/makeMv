/**
 * utils/async-pool.ts
 * 轻量通用异步并发池（受任务取消信号约束）
 *
 * 只做「限流 + 可取消」，不含任何业务语义；
 * 需要「排队 + 超时 + 模型配额」的场景仍走 LLMProvider 的 batchPool。
 */

import { throwIfRunAborted } from '../workflow-engine/run-context.js';

export async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T, index: number) => Promise<R>,
  label = 'AsyncPool'
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing: Set<Promise<any>> = new Set();

  for (let i = 0; i < array.length; i++) {
    throwIfRunAborted(label);
    const item = array[i];
    const p = Promise.resolve().then(() => {
      throwIfRunAborted(label);
      return iteratorFn(item, i);
    });
    ret.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean, clean);

    if (executing.size >= poolLimit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(ret);
}
