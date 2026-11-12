/**
 * workflow-engine/progress.ts
 * 真实切面带权重进度条广播器 (AOP Weight-based Progress SSOT)
 *
 * 核心机制（吸收老系统黄金资产）：
 * 1. 彻底消灭虚假心跳定时器，进度 100% 由工序真实执行切面驱动；
 * 2. 支持步骤权重配置，按耗时真实比例归一化映射到 10% ~ 95% 区间；
 * 3. 统一与 TaskStore 无缝联动。
 */

import type { Workflow } from '@mastra/core/workflows';
import { TaskStore } from './TaskStore.js';
import type { ProgressReporter } from './types.js';

export interface WorkflowStepProgressConfig {
  stepId: string;
  percent: number;
  note: string;
}

export interface ProgressReportOptions {
  projectId: string;
  taskId: string;
  stepIndex?: number;
  totalSteps?: number;
}

/**
 * 按权重数组计算「第 upto 个步骤完成时」的全局百分比 (统一映射到 10~95 区间)
 */
export function calculateWeightedPercent(weights: number[], uptoStep: number): number {
  const total = weights.reduce((acc, cur) => acc + cur, 0);
  if (total <= 0) return 10;
  const accumulated = weights.slice(0, uptoStep).reduce((acc, cur) => acc + cur, 0);
  return Math.min(95, Math.max(10, Math.round((accumulated / total) * 95)));
}

/**
 * 创建高内聚任务进度上报器
 */
export function createProgressReporter(projectId: string, taskId: string) {
  const taskStore = TaskStore.getInstance();

  return (percent: number, note: string, stepInfo?: { current: number; total: number }) => {
    try {
      taskStore.updateProgress(projectId, taskId, {
        percent: Math.min(100, Math.max(0, percent)),
        note,
        current: stepInfo?.current,
        total: stepInfo?.total,
      });
    } catch {
      // 容错防崩，保证主干执行不受统计影响
    }
  };
}

/**
 * 监听 Mastra Workflow 实例真实的 XState 步骤迁移事件，按工序执行顺序单调上报进度。
 * 通过 runId 隔离同实例潜在并发运行，防止多运行互串与进度倒退。
 */
export function attachWorkflowStepProgress(
  workflow: Workflow<any, any>,
  runId: string,
  steps: ReadonlyArray<WorkflowStepProgressConfig>,
  onProgress?: ProgressReporter
): () => void {
  if (!onProgress || steps.length === 0) {
    return () => {};
  }

  let lastReportedIdx = -1;

  return workflow.watch((state) => {
    if ((state as any)?.runId && (state as any).runId !== runId) {
      return;
    }

    const activePaths = Array.isArray((state as any)?.activePaths)
      ? (state as any).activePaths
      : [];
    const completedSteps = (state as any)?.context?.steps || {};

    let matchedIdx = -1;
    for (let i = 0; i < steps.length; i++) {
      const sid = steps[i].stepId;
      const isActive = activePaths.some(
        (p: any) =>
          (p?.stepId === sid || p?.stepPath?.[0] === sid) && p?.status !== 'completed'
      );
      const isDone = completedSteps[sid]?.status === 'success';
      if (isActive || isDone) {
        matchedIdx = Math.max(matchedIdx, i);
      }
    }

    if (matchedIdx > lastReportedIdx) {
      lastReportedIdx = matchedIdx;
      const cfg = steps[matchedIdx];
      onProgress(cfg.percent, cfg.note, {
        current: matchedIdx + 1,
        total: steps.length,
      });
    }
  });
}
