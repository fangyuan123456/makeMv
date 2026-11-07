/**
 * 任务快照合并 (Task Snapshot Merge)
 *
 * 客户端的任务数据有两个入口：SSE 实时推送 (onTask) 与 2s 轮询全量拉取。
 * 两者的到达顺序不保证——轮询请求可能先发出、SSE 事件后到达，
 * 于是「较旧的轮询响应」会覆盖「较新的推送」，表现为进度条往回跳、
 * 已结算的任务被打回执行中。
 *
 * 合并规则：
 * 1. 终态是单向门：已 succeeded / failed / cancelled 的任务不会退回非终态；
 * 2. 进度不回退：同为 running 时保留 percent 更高的一侧
 *    （失败重试会把任务显式复位为 queued，不在此列）；
 * 3. 渲染字段无变化时复用原对象引用，避免每 2s 触发整棵气泡树重渲染。
 */

import type { TaskItem, TaskStatus } from '../components/studio/studio.types';

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['succeeded', 'failed', 'cancelled']);

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** 在「本地已有」与「新拉到」之间挑一个更新的一方 */
function preferNewer(current: TaskItem, incoming: TaskItem): TaskItem {
  if (isTerminalStatus(current.status) && !isTerminalStatus(incoming.status)) {
    /*
     * 终态回溯要区分两种情况：
     * - 迟到的旧响应：任务其实已经结束，不能被打回执行中；
     * - 失败重试的复位：服务端 resetForRetry 会清掉 finishedAt，这是合法的新一轮。
     * succeeded 没有重试路径，任何非终态的迟到数据都不采信。
     */
    if (current.status === 'succeeded') return current;
    if (incoming.finishedAt) return current;
  }
  if (current.status === 'running' && incoming.status === 'running') {
    const currentPercent = current.progress?.percent ?? 0;
    const incomingPercent = incoming.progress?.percent ?? 0;
    if (incomingPercent < currentPercent) return current;
  }
  return incoming;
}

/** 只比较气泡渲染真正读取的字段 */
function isTaskRenderEqual(a: TaskItem, b: TaskItem): boolean {
  if (a.status !== b.status) return false;
  if (a.title !== b.title || a.description !== b.description) return false;
  if (a.resultSummary !== b.resultSummary || a.error !== b.error) return false;
  if (a.startedAt !== b.startedAt || a.finishedAt !== b.finishedAt) return false;

  const pa = a.progress;
  const pb = b.progress;
  if (!pa !== !pb) return false;
  if (pa && pb) {
    if (pa.current !== pb.current || pa.total !== pb.total) return false;
    if (pa.percent !== pb.percent || pa.note !== pb.note) return false;
  }

  const aa = a.artifacts || [];
  const ab = b.artifacts || [];
  if (aa.length !== ab.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i].stage !== ab[i].stage) return false;
    if (aa[i].url !== ab[i].url) return false;
    if (aa[i].summary !== ab[i].summary) return false;
  }
  return true;
}

/**
 * 把一次全量拉取结果合并进本地快照。
 * 返回值在「结构无变化」时就是 current 本身，便于 useState 提前 bail out。
 */
export function mergeTaskSnapshot(
  current: Record<string, TaskItem>,
  incoming: TaskItem[]
): Record<string, TaskItem> {
  const next: Record<string, TaskItem> = {};
  const incomingIds = new Set<string>();
  let changed = false;

  for (const raw of incoming) {
    if (!raw?.taskId) continue;
    incomingIds.add(raw.taskId);

    const existing = current[raw.taskId];
    if (!existing) {
      next[raw.taskId] = raw;
      changed = true;
      continue;
    }

    const merged = preferNewer(existing, raw);
    if (merged === existing || isTaskRenderEqual(existing, merged)) {
      next[raw.taskId] = existing; // 复用引用：气泡不重渲染
    } else {
      next[raw.taskId] = merged;
      changed = true;
    }
  }

  // 服务端已裁剪 / 已切项目的任务，本地不再保留
  const currentIds = Object.keys(current);
  if (currentIds.length !== incomingIds.size) {
    changed = true;
  } else {
    for (const id of currentIds) {
      if (!incomingIds.has(id)) {
        changed = true;
        break;
      }
    }
  }

  return changed ? next : current;
}
