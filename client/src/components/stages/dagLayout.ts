/**
 * 故事图谱 DAG 分层（零依赖，便于单测与任何渲染器复用）
 */

export interface DagEdge {
  from: string;
  to: string;
}

/**
 * 计算故事图谱的列号（rank），供所有拓扑图共用。
 *
 * 采用 Kahn 拓扑排序 + 最长路径分层：每条边只被消费一次，因此**必然终止**。
 * 早期实现用「队列 + newRank > existing」求最长路径，遇到自环（A→A）或环时
 * 条件恒成立、队列无限增长，直接把浏览器主线程锁死（画面卡住无法交互）。
 * 这里把自环、悬空目标、重复边在入表阶段就剔除，环上剩余节点兜底到第 1 列。
 */
export function computeDagRanks(
  nodeIds: string[],
  edges: DagEdge[],
  startId?: string
): Map<string, number> {
  const ids = new Set(nodeIds);
  const outgoing = new Map<string, string[]>();
  nodeIds.forEach((id) => outgoing.set(id, []));

  const seenEdges = new Set<string>();
  edges.forEach(({ from, to }) => {
    if (!from || !to || from === to) return;
    if (!ids.has(from) || !ids.has(to)) return;
    const key = `${from}\u0000${to}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    outgoing.get(from)!.push(to);
  });

  const indeg = new Map<string, number>();
  nodeIds.forEach((id) => indeg.set(id, 0));
  outgoing.forEach((list) => list.forEach((to) => indeg.set(to, (indeg.get(to) || 0) + 1)));

  const rank = new Map<string, number>();
  if (startId && ids.has(startId)) rank.set(startId, 0);

  const queue: string[] = [];
  indeg.forEach((d, id) => {
    if (d === 0) queue.push(id);
  });
  // 起点若带前驱（悬挂回边），仍强制从它开始，否则起点这一层会被整段跳过
  if (startId && ids.has(startId) && !queue.includes(startId)) {
    indeg.set(startId, 0);
    queue.unshift(startId);
  }

  // 每个节点只扩展一次：即使存在环，也只是边被少消费，不会重复入队
  const expanded = new Set<string>();
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (expanded.has(cur)) continue;
    expanded.add(cur);
    const curRank = rank.get(cur) ?? 0;
    for (const nxt of outgoing.get(cur) || []) {
      if (nxt !== startId) {
        const candidate = curRank + 1;
        if ((rank.get(nxt) ?? -1) < candidate) rank.set(nxt, candidate);
      }
      const d = (indeg.get(nxt) || 0) - 1;
      indeg.set(nxt, d);
      if (d === 0) queue.push(nxt);
    }
  }

  nodeIds.forEach((id) => {
    if (!rank.has(id)) rank.set(id, 1);
  });
  return rank;
}
