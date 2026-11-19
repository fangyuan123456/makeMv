import type { PlanStepRecord } from './types.js';

export interface ChatTaskContext {
  sessionId: string;
  messageId: string;
  planStepIndex?: number;
}

export function stripTaskStateFromMessages<T extends Record<string, any>>(messages: T[]): Record<string, any>[] {
  return messages.map((message) => {
    const { taskStatus, taskProgress, taskDurationMs, taskError, ...facts } = message;
    if (!Array.isArray(facts.planSteps)) return facts;
    return {
      ...facts,
      planSteps: facts.planSteps.map((step: Record<string, any>) => {
        const { status, progress, durationMs, error, ...binding } = step;
        return binding;
      }),
    };
  });
}

export function computePlanAggregate(steps: PlanStepRecord[]): {
  taskStatus: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  taskProgress: { current: number; total: number; percent: number; message: string };
  taskDurationMs?: number;
  taskError?: string;
} {
  const total = steps.length;
  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const failedSteps = steps.filter((s) => s.status === 'failed');
  const cancelledCount = steps.filter((s) => s.status === 'cancelled').length;
  const runningStep = steps.find((s) => s.status === 'running');
  const activeCount = steps.filter((s) => s.status === 'pending' || s.status === 'running').length;

  let taskStatus: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  if (activeCount > 0) {
    taskStatus = runningStep || completedCount > 0 ? 'running' : 'pending';
  } else if (failedSteps.length > 0) {
    taskStatus = 'failed';
  } else if (cancelledCount > 0 && completedCount === 0) {
    taskStatus = 'cancelled';
  } else {
    taskStatus = 'completed';
  }

  const percent = total > 0 ? Math.round((completedCount / total) * 100) : 100;
  const message = runningStep
    ? `正在执行 (${completedCount + 1}/${total})：${runningStep.title}`
    : activeCount > 0
    ? `等待执行 (${completedCount}/${total})`
    : failedSteps.length > 0
    ? `完成 ${completedCount}/${total}，失败 ${failedSteps.length} 项`
    : cancelledCount > 0
    ? `已取消（已完成 ${completedCount}/${total}）`
    : `全部 ${total} 项已完成`;

  const totalDurationMs =
    activeCount === 0
      ? steps.reduce((sum, s) => sum + (s.durationMs || 0), 0)
      : undefined;

  return {
    taskStatus,
    taskProgress: { current: completedCount, total, percent, message },
    ...(totalDurationMs !== undefined && totalDurationMs > 0 ? { taskDurationMs: totalDurationMs } : {}),
    ...(failedSteps.length > 0 ? { taskError: failedSteps.map((s) => `${s.title}: ${s.error || '执行失败'}`).join('；') } : {}),
  };
}

