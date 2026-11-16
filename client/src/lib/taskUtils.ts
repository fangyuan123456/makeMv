/**
 * client/src/lib/taskUtils.ts
 * 全局统一实体任务活跃态判定工具 (Universal Task Inspector SSOT)
 *
 * 核心机制：
 * 1. 【单一事实来源】严格基于全局 tasks 任务总线判定，杜绝任何局部私有 Set 状态泄漏；
 * 2. 【多层匹配】支持单工具/多工具匹配、单实体 ID / 多字段别名匹配；
 * 3. 【健壮安全】内置判空与防御性过滤，彻底消除跨组件状态脱节。
 */

import type { TaskRecord } from '../types/index.js';

export interface EntityMatchCriteria {
  /** 实体主 ID，如 characterId, locationId, shotId 等 */
  [key: string]: string | undefined;
}

/**
 * 判定指定的业务实体当前是否正处于后台任务活跃执行状态（running 或 pending）
 *
 * @param tasks 全局任务记录列表
 * @param toolNames 需要匹配的工具名或工具名列表
 * @param entityMatch 实体特征匹配键值对，例如 { characterId: char.id, id: char.id }
 * @returns boolean
 */
export function isEntityTaskRunning(
  tasks: TaskRecord[] | undefined,
  toolNames: string | string[],
  entityMatch: EntityMatchCriteria
): boolean {
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    return false;
  }

  const allowedTools = Array.isArray(toolNames) ? toolNames : [toolNames];

  // 提取待匹配的非空有效 ID 集合
  const targetIds = new Set<string>();
  for (const val of Object.values(entityMatch)) {
    if (val && typeof val === 'string' && val.trim().length > 0) {
      targetIds.add(val.trim());
    }
  }

  if (targetIds.size === 0) {
    return false;
  }

  return tasks.some((t) => {
    // 1. 状态门禁：必须是正在运行或排队中
    if (t.status !== 'running' && t.status !== 'pending') {
      return false;
    }

    // 1.1 超时失效保护门禁：生图/渲染任务超过 5 分钟未返回则视为陈旧失联任务，解除 UI 锁定，允许用户重新发起
    if (t.createdAt && Date.now() - t.createdAt > 300000) {
      return false;
    }

    // 2. 工具名门禁
    if (!allowedTools.includes(t.toolName)) {
      return false;
    }

    // 3. 实体特征匹配
    const input = t.input || {};

    // 检查 input 包含的所有值中是否存在目标 ID
    for (const key of Object.keys(input)) {
      const inputVal = input[key];
      if (typeof inputVal === 'string' && targetIds.has(inputVal.trim())) {
        return true;
      }
    }

    return false;
  });
}

/**
 * 任务生命周期状态单向跃迁权重：终态 (completed, failed, cancelled) > 活跃态 (running) > 初始排队态 (pending)
 */
const STATUS_PRIORITY: Record<string, number> = {
  pending: 1,
  running: 2,
  cancelled: 3,
  failed: 3,
  completed: 3,
};

/**
 * 全局统一任务状态权威合并工具 (Universal Task Upsert SSOT)
 *
 * 核心机制：
 * 1. 【单一事实来源】严格以 taskId 为全局唯一业务主键；
 * 2. 【状态单向跃迁】终态 > 活跃态 > 初始排队态，杜绝 HTTP 响应与 SSE 推送时序竞态导致的低阶状态逆向冲刷；
 * 3. 【无损属性补全】合并新旧属性（progress, output, error, durationMs, input 等），杜绝数据丢失；
 * 4. 【时间倒序】始终按 createdAt 倒序输出最新流水。
 *
 * @param prevTasks 现有任务列表
 * @param incoming 新产生或更新的任务记录（单个或批量）
 * @returns 规范去重后的任务列表
 */
export function upsertTaskRecords(
  prevTasks: TaskRecord[] | undefined,
  incoming: TaskRecord | TaskRecord[] | undefined | null
): TaskRecord[] {
  const currentList = Array.isArray(prevTasks) ? prevTasks : [];
  if (!incoming) return currentList;

  const incomingList = Array.isArray(incoming) ? incoming : [incoming];
  if (incomingList.length === 0) return currentList;

  const taskMap = new Map<string, TaskRecord>();

  // 1. 装载现有任务
  for (const t of currentList) {
    if (t?.taskId) {
      taskMap.set(t.taskId, { ...t });
    }
  }

  // 2. 权威合并或新增
  for (const inc of incomingList) {
    if (!inc?.taskId) continue;
    const existing = taskMap.get(inc.taskId);

    if (!existing) {
      taskMap.set(inc.taskId, { ...inc });
    } else {
      const existingWeight = STATUS_PRIORITY[existing.status] || 0;
      const incomingWeight = STATUS_PRIORITY[inc.status] || 0;

      // 若已有状态权重更高（例如已处于 running 或 completed），绝不倒退回低权重（如 pending）
      const shouldPreserveExistingStatus = existingWeight > incomingWeight;

      taskMap.set(inc.taskId, {
        ...existing,
        ...inc,
        status: shouldPreserveExistingStatus ? existing.status : inc.status,
        progress: inc.progress !== undefined ? inc.progress : existing.progress,
        output: inc.output !== undefined ? inc.output : existing.output,
        error: inc.error !== undefined ? inc.error : existing.error,
        durationMs: inc.durationMs !== undefined ? inc.durationMs : existing.durationMs,
        startedAt: inc.startedAt || existing.startedAt,
        completedAt: inc.completedAt || existing.completedAt,
      });
    }
  }

  // 3. 始终按创建时间倒序排列
  return Array.from(taskMap.values()).sort(
    (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
  );
}

