/**
 * workflow-engine/concurrency.ts
 * 并发域隔离与物理算力限流基建 (KeyedLockManager + ConcurrencyPool + ProjectLaneScheduler)
 *
 * 1. KeyedLockManager: 按 key (如 projectId / projectId:entityId) 串行排队，不同 key 完全并发；
 * 2. ConcurrencyPool: 支持 AbortSignal 的有界异步信号量，用于 GPU / 批处理 LLM 并发池；
 * 3. ProjectLaneScheduler: 托管同项目后台异步任务链并追踪排队深度。
 */

import { RunAbortedError } from './run-context.js';

export class KeyedLockManager {
  private chains = new Map<string, Promise<void>>();

  public async withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nextTail = prev.then(() => current);
    this.chains.set(key, nextTail);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.chains.get(key) === nextTail) {
        this.chains.delete(key);
      }
    }
  }

  public isBusy(key: string): boolean {
    return this.chains.has(key);
  }
}

export class ConcurrencyPool {
  private maxConcurrency: number;
  private activeCount = 0;
  private waiters: Array<{
    resolve: (release: () => void) => void;
    reject: (err: any) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  constructor(maxConcurrency: number) {
    this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
  }

  public get limit(): number {
    return this.maxConcurrency;
  }

  public setLimit(limit: number): void {
    this.maxConcurrency = Math.max(1, Math.floor(limit));
    this.drainWaiters();
  }

  public get active(): number {
    return this.activeCount;
  }

  public get pending(): number {
    return this.waiters.length;
  }

  private makeReleaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.drainWaiters();
    };
  }

  private drainWaiters(): void {
    while (this.activeCount < this.maxConcurrency && this.waiters.length > 0) {
      const next = this.waiters.shift()!;
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      if (next.signal?.aborted) {
        next.reject(new RunAbortedError('[ConcurrencyPool] 等待算力槽位期间任务已被取消'));
        continue;
      }
      this.activeCount++;
      next.resolve(this.makeReleaser());
    }
  }

  public acquire(abortSignal?: AbortSignal): Promise<() => void> {
    if (abortSignal?.aborted) {
      return Promise.reject(new RunAbortedError('[ConcurrencyPool] 请求已被取消，跳过排队'));
    }

    if (this.activeCount < this.maxConcurrency && this.waiters.length === 0) {
      this.activeCount++;
      return Promise.resolve(this.makeReleaser());
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: (typeof this.waiters)[number] = {
        resolve,
        reject,
        signal: abortSignal,
      };

      if (abortSignal) {
        const onAbort = () => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) {
            this.waiters.splice(idx, 1);
          }
          reject(new RunAbortedError('[ConcurrencyPool] 等待算力槽位期间任务已被取消'));
        };
        waiter.onAbort = onAbort;
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      this.waiters.push(waiter);
    });
  }

  public async run<T>(fn: () => PromiseLike<T> | T, abortSignal?: AbortSignal): Promise<T> {
    const release = await this.acquire(abortSignal);
    try {
      if (abortSignal?.aborted) {
        throw new RunAbortedError('[ConcurrencyPool] 任务已取消，中止执行');
      }
      return await Promise.resolve(fn());
    } finally {
      release();
    }
  }
}

export class ProjectLaneScheduler {
  private lockManager = new KeyedLockManager();
  private depths = new Map<string, number>();

  public getQueueDepth(projectId: string): number {
    return this.depths.get(projectId) || 0;
  }

  public enqueue<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const nextDepth = (this.depths.get(projectId) || 0) + 1;
    this.depths.set(projectId, nextDepth);

    return this.lockManager.withLock(projectId, fn).finally(() => {
      const remaining = (this.depths.get(projectId) || 1) - 1;
      if (remaining <= 0) {
        this.depths.delete(projectId);
      } else {
        this.depths.set(projectId, remaining);
      }
    });
  }
}

export const projectLockManager = new KeyedLockManager();
