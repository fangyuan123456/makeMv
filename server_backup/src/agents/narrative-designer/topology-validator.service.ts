import { InteractiveStoryGraph, GraphValidationResult } from './types.js';

export class TopologyValidatorService {
  /**
   * 对互动网状故事图执行静态拓扑分析与完整性质量保障。
   */
  validate(graph: InteractiveStoryGraph): GraphValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];
    const unreachableNodes: string[] = [];
    const deadlockPaths: string[] = [];
    const leafNodes: string[] = [];

    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();

    for (const node of graph.nodes) {
      outgoing.set(node.id, []);
      incoming.set(node.id, []);
    }

    for (const choice of graph.choices) {
      if (!nodeMap.has(choice.fromNodeId)) {
        issues.push(`分支选项 [${choice.id}] 的起始节点 [${choice.fromNodeId}] 不存在`);
      }
      if (!nodeMap.has(choice.toNodeId)) {
        issues.push(`分支选项 [${choice.id}] 指向的目标节点 [${choice.toNodeId}] 不存在`);
      }

      if (nodeMap.has(choice.fromNodeId) && nodeMap.has(choice.toNodeId)) {
        outgoing.get(choice.fromNodeId)!.push(choice.toNodeId);
        incoming.get(choice.toNodeId)!.push(choice.fromNodeId);
      }
    }

    // 1. BFS Reachability Check from startNodeId
    const reachable = new Set<string>();
    const startId = graph.startNodeId || graph.nodes[0]?.id;

    if (!startId || !nodeMap.has(startId)) {
      issues.push(`起始节点 [${startId}] 未指定或不存在于故事图中`);
    } else {
      const queue = [startId];
      reachable.add(startId);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const neighbors = outgoing.get(curr) || [];
        for (const nxt of neighbors) {
          if (!reachable.has(nxt)) {
            reachable.add(nxt);
            queue.push(nxt);
          }
        }
      }

      for (const node of graph.nodes) {
        if (!reachable.has(node.id)) {
          unreachableNodes.push(node.id);
          issues.push(`节点 [${node.id}] (${node.title}) 无法从起点到达，属于孤立死节点`);
        }
      }
    }

    // 2. Deadlock & Terminal Node Detection
    let terminalNodesCount = 0;
    for (const node of graph.nodes) {
      const out = outgoing.get(node.id) || [];
      if (out.length === 0) {
        leafNodes.push(node.id);
        if (node.type === 'bad_end' || node.type === 'true_end') {
          terminalNodesCount++;
        } else {
          deadlockPaths.push(node.id);
          issues.push(`节点 [${node.id}] (${node.title}) 既无分支选项，又未标记为结局节点（bad_end / true_end），存在游玩死锁！`);
        }
      }
    }

    // 3. Convergence Calculation (Diamond Convergence Rate)
    const decisionNodes = graph.nodes.filter((n) => n.type === 'decision' || (outgoing.get(n.id) || []).length > 1);
    const convergeNodes = graph.nodes.filter((n) => n.type === 'converge' || (incoming.get(n.id) || []).length > 1);

    const convergenceRate = decisionNodes.length > 0
      ? Math.min(1.0, Number((convergeNodes.length / decisionNodes.length).toFixed(2)))
      : 1.0;

    if (convergenceRate < 0.3 && decisionNodes.length >= 2) {
      warnings.push(`分支过度发散警告：收束率为 ${(convergenceRate * 100).toFixed(0)}%，分支数量过多可能导致制作成本剧增，建议增加收束节点 (converge)`);
    }

    // 4. Calculate total estimated duration
    const totalEstimatedDurationSec = graph.nodes.reduce(
      (sum, n) => sum + (n.estimatedDurationSec || 15),
      0
    );

    return {
      isPass: issues.length === 0,
      unreachableNodes,
      deadlockPaths,
      leafNodes,
      convergenceRate,
      totalEstimatedDurationSec,
      issues,
      warnings,
    };
  }
}

export const topologyValidator = new TopologyValidatorService();
