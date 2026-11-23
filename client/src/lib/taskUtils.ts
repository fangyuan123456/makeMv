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

export interface ConversationTaskRunningScope {
  mode?: 'lookdev' | 'storyboard' | 'planner' | string;
  clipId?: string;
  focusTargetId?: string;
}

export function isConversationTaskRunning(
  tasks: TaskRecord[] | undefined,
  sessionId: string,
  scope?: ConversationTaskRunningScope
): boolean {
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) return false;

  return tasks.some((task) => {
    if (task.status !== 'running' && task.status !== 'pending') return false;

    // 1. 显式会话匹配（通过当前对话卡片“批准执行”触发）
    if (task.input?.__chatContext?.sessionId === sessionId) return true;

    // 2. 当前视口聚焦目标匹配（若正聚焦该实体，且该实体正在跑物理工具）
    if (scope?.focusTargetId) {
      const tid = scope.focusTargetId.trim();
      if (
        task.input?.targetId === tid ||
        task.input?.shotId === tid ||
        task.input?.characterId === tid ||
        task.input?.locationId === tid ||
        task.input?.itemId === tid
      ) {
        return true;
      }
    }

    // 3. 专属工序与分幕域匹配（从外部画布/抽屉直接触发的任务）
    const effectiveMode =
      scope?.mode ||
      (sessionId.startsWith('storyboard')
        ? 'storyboard'
        : sessionId === 'lookdev'
        ? 'lookdev'
        : sessionId === 'planner'
        ? 'planner'
        : undefined);

    if (effectiveMode === 'storyboard') {
      const targetClipId =
        scope?.clipId ||
        (sessionId.startsWith('storyboard_') ? sessionId.replace(/^storyboard_/, '') : undefined);
      if (targetClipId) {
        if (task.input?.clipId === targetClipId) return true;
        if (typeof task.input?.shotId === 'string' && task.input.shotId.startsWith(`${targetClipId}-`)) return true;
        if (typeof task.input?.targetId === 'string' && task.input.targetId.startsWith(`${targetClipId}-`)) return true;
      }
    } else if (effectiveMode === 'lookdev') {
      const lookdevTools = ['film.lookdev', 'film.asset_manifest', 'film.entity_spec'];
      if (lookdevTools.includes(task.toolName)) return true;
      if (task.toolName === 'film.image_upscale' && ['character', 'location', 'item'].includes(task.input?.targetKind)) {
        return true;
      }
    } else if (effectiveMode === 'planner') {
      const plannerTools = ['planner.screenplay', 'planner.script_to_prd'];
      if (plannerTools.includes(task.toolName)) return true;
    }

    return false;
  });
}

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

    // 2. 工具名门禁
    if (!allowedTools.includes(t.toolName)) {
      return false;
    }

    // 3. 实体特征匹配（统一原子契约：targetKind + targetId 或直接字段匹配）
    const input = t.input || {};
    const requestedTypes = new Set(Object.keys(entityMatch).map((key) =>
      key === 'characterId' ? 'character' : key === 'locationId' ? 'location' : key === 'itemId' ? 'item' : ''
    ).filter(Boolean));
    if (
      typeof input.targetId === 'string' &&
      targetIds.has(input.targetId.trim()) &&
      (!requestedTypes.size || !input.targetKind || requestedTypes.has(input.targetKind))
    ) {
      return true;
    }

    // 检查 input 包含的其他标量字段中是否存在目标 ID
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
      taskMap.set(inc.taskId, {
        ...inc,
        createdAt: inc.createdAt || (inc as any).timestamp || Date.now(),
      });
    } else {
      const existingWeight = STATUS_PRIORITY[existing.status] || 0;
      const incomingWeight = STATUS_PRIORITY[inc.status] || 0;

      // 若已有状态权重更高（例如已处于 running 或 completed），绝不倒退回低权重（如 pending）
      const shouldPreserveExistingStatus = existingWeight > incomingWeight;

      taskMap.set(inc.taskId, {
        ...existing,
        ...inc,
        status: shouldPreserveExistingStatus ? existing.status : inc.status,
        createdAt: inc.createdAt || existing.createdAt || (inc as any).timestamp || Date.now(),
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

/**
 * 获取与指定实体关联的最新一个任务记录（按时间倒序检查）
 */
export function getEntityLatestTask(
  tasks: TaskRecord[] | undefined,
  toolNames: string | string[],
  entityMatch: EntityMatchCriteria
): TaskRecord | undefined {
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) return undefined;
  const allowedTools = Array.isArray(toolNames) ? toolNames : [toolNames];

  const targetIds = new Set<string>();
  for (const val of Object.values(entityMatch)) {
    if (val && typeof val === 'string' && val.trim().length > 0) {
      targetIds.add(val.trim());
    }
  }
  if (targetIds.size === 0) return undefined;

  // 按时间倒序寻找第一个命中的任务
  const sorted = [...tasks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return sorted.find((t) => {
    if (!allowedTools.includes(t.toolName)) return false;
    const input = t.input || {};
    if (typeof input.targetId === 'string' && targetIds.has(input.targetId.trim())) return true;
    for (const key of Object.keys(input)) {
      const inputVal = input[key];
      if (typeof inputVal === 'string' && targetIds.has(inputVal.trim())) return true;
    }
    return false;
  });
}

/**
 * 获取实体的任务健康状态
 */
export function getEntityTaskStatus(
  tasks: TaskRecord[] | undefined,
  toolNames: string | string[],
  entityMatch: EntityMatchCriteria
): {
  status: 'idle' | 'running' | 'completed' | 'failed';
  task?: TaskRecord;
  error?: string;
  failureType?: string;
} {
  const latest = getEntityLatestTask(tasks, toolNames, entityMatch);
  if (!latest) return { status: 'idle' };

  if (latest.status === 'running' || latest.status === 'pending') {
    return { status: 'running', task: latest };
  }
  if (latest.status === 'failed') {
    return {
      status: 'failed',
      task: latest,
      error: latest.error || '执行异常',
      failureType: latest.failureType || 'system_fault',
    };
  }
  if (latest.status === 'completed') {
    return { status: 'completed', task: latest };
  }
  return { status: 'idle', task: latest };
}

