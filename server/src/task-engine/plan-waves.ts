/**
 * task-engine/plan-waves.ts
 * 任务波次切分与受控并发编排器 (Wave Partitioning SSOT)
 *
 * 核心调度哲学：
 * - 同一波次内：相同工具 + 互斥独立的单实体/单镜头标的 → 受控并发起跑；
 * - 跨波次之间：不同工具、同一实体冲突或全局项目独占工具 → 严格等待上一波次全部终态后再接力启动。
 */

import { resolveTaskEntityLockKey } from './task-dispatcher.js';

export interface PlanOperationItem {
  tool: string;
  title?: string;
  params?: Record<string, any>;
}

export interface PlanWaveItem {
  index: number;
  operation: PlanOperationItem;
}

/**
 * 将多步 Plan 的 operations[] 按工具与目标实体边界切分为顺序执行波次 (Waves)
 */
export function partitionPlanWaves(
  projectId: string,
  operations: PlanOperationItem[]
): PlanWaveItem[][] {
  const waves: PlanWaveItem[][] = [];
  let currentWave: PlanWaveItem[] = [];
  let currentTool = '';
  let currentKeys = new Set<string>();

  for (const [index, operation] of operations.entries()) {
    const lockKey = resolveTaskEntityLockKey(projectId, operation.tool, operation.params);
    const canJoinCurrentWave =
      Boolean(lockKey) &&
      currentWave.length > 0 &&
      currentTool === operation.tool &&
      !currentKeys.has(lockKey!);

    if (canJoinCurrentWave) {
      currentWave.push({ index, operation });
      currentKeys.add(lockKey!);
    } else {
      if (currentWave.length > 0) {
        waves.push(currentWave);
      }
      currentWave = [{ index, operation }];
      currentTool = lockKey ? operation.tool : '';
      currentKeys = lockKey ? new Set([lockKey]) : new Set();
    }
  }

  if (currentWave.length > 0) {
    waves.push(currentWave);
  }
  return waves;
}
