/**
 * workflow-engine/run-context.ts
 * 基于 AsyncLocalStorage 的单次工作流执行域上下文与中止信号传播器
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export type ExecutionLane = 'batch' | 'interactive';

export interface WorkflowRunContext {
  projectId: string;
  runId: string;
  lane: ExecutionLane;
  abortSignal?: AbortSignal;
}

const runContextStorage = new AsyncLocalStorage<WorkflowRunContext>();

export class RunAbortedError extends Error {
  public readonly isAbort = true;

  constructor(message: string = '[Workflow] 任务已被创作者主动取消') {
    super(message);
    this.name = 'AbortError';
  }
}

export function withRunContext<T>(ctx: WorkflowRunContext, fn: () => Promise<T>): Promise<T> {
  return runContextStorage.run(ctx, fn);
}

export function getRunContext(): WorkflowRunContext | undefined {
  return runContextStorage.getStore();
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return Boolean(getRunContext()?.abortSignal?.aborted);
  }
  const e = err as { name?: string; isAbort?: boolean; message?: string };
  if (e.isAbort || e.name === 'AbortError') return true;
  if (typeof e.message === 'string' && e.message.includes('已被创作者主动取消')) return true;
  return Boolean(getRunContext()?.abortSignal?.aborted);
}

export function throwIfRunAborted(scope: string = 'Workflow'): void {
  const ctx = getRunContext();
  if (ctx?.abortSignal?.aborted) {
    throw new RunAbortedError(`[${scope}] 任务 [${ctx.runId}] 已被创作者主动取消`);
  }
}

export function combineAbortSignals(
  a?: AbortSignal,
  b?: AbortSignal
): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  if (a.aborted || b.aborted) {
    const ctrl = new AbortController();
    ctrl.abort(a.aborted ? a.reason : b.reason);
    return ctrl.signal;
  }
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([a, b]);
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return ctrl.signal;
}
