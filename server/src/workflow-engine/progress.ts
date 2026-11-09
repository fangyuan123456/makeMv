/**
 * workflow-engine/progress.ts
 * 真实切面带权重进度条广播器 (AOP Weight-based Progress SSOT)
 *
 * 核心机制（吸收老系统黄金资产）：
 * 1. 彻底消灭虚假心跳定时器，进度 100% 由工序真实执行切面驱动；
 * 2. 支持步骤权重配置，按耗时真实比例归一化映射到 10% ~ 95% 区间；
 * 3. 统一与 TaskStore 无缝联动。
 */

import { TaskStore } from './TaskStore.js';

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
