/** 确定性结构校验；自然语言事实一致性仍由编剧约束负责。 */
export function validateStoryGraph(
  start: string,
  nodes: { id: string; terminal: boolean; targets: string[] }[],
): void {
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (byId.size !== nodes.length) throw new Error('故事图包含重复节点 ID');
  if (!byId.has(start)) throw new Error(`故事入口不存在：${start}`);
  for (const node of nodes) {
    if (node.terminal ? node.targets.length > 0 : node.targets.length === 0) {
      throw new Error(`节点 ${node.id} 的后继与终局类型不符`);
    }
    for (const target of node.targets) {
      if (!byId.has(target)) throw new Error(`节点 ${node.id} 指向不存在的目标 ${target}`);
    }
  }
  const reachable = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...byId.get(id)!.targets);
  }
  const canEnd = new Set(nodes.filter(n => n.terminal).map(n => n.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!canEnd.has(node.id) && node.targets.some(t => canEnd.has(t))) {
        canEnd.add(node.id);
        changed = true;
      }
    }
  }
  for (const node of nodes) {
    if (!reachable.has(node.id)) throw new Error(`节点不可达：${node.id}`);
    if (!canEnd.has(node.id)) throw new Error(`节点无法到达终局：${node.id}`);
  }
}
