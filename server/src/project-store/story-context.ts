import type { UniversalPrdSpec } from './contracts/planner/index.js';

/** Find adjacent story clips through interaction nodes, never through array order. */
export function buildBranchContext(
  prd: Pick<UniversalPrdSpec, 'clips' | 'interactions' | 'wiring' | 'startNodeId'>,
  clipId: string,
  sections: Record<string, { narrativeText?: string }>,
): { previousClipSummary: string; nextClipSummary: string } {
  const clips = new Map(prd.clips.map((clip) => [clip.id, clip]));
  const interactions = new Set(prd.interactions.map((node) => node.id));
  const collect = (reverse: boolean): string => {
    const found = new Set<string>();
    const visited = new Set<string>([clipId]);
    const pending = [clipId];
    while (pending.length) {
      const nodeId = pending.shift()!;
      for (const edge of prd.wiring) {
        if ((reverse ? edge.to : edge.from) !== nodeId) continue;
        const adjacent = reverse ? edge.from : edge.to;
        if (visited.has(adjacent)) continue;
        visited.add(adjacent);
        if (clips.has(adjacent)) found.add(adjacent);
        else if (interactions.has(adjacent)) pending.push(adjacent);
      }
    }
    if (!found.size) {
      return reverse && prd.startNodeId === clipId
        ? '当前片段是剧情图明确指定的开篇。'
        : '剧情图未提供相邻片段；不可据此推断开篇、终局或补造剧情。';
    }
    return '以下为剧情图连接的候选片段，各路径可能互斥，不代表同时发生。仅承接当前正文明确成立的状态；无法确定的伤情、道具与情绪不可合并为事实。\n' +
      [...found].map((id) => `- 【${id} · ${clips.get(id)!.title}】：${sections[id]?.narrativeText?.slice(0, 240) || '正文未提供，仅确认连接关系'}`).join('\n');
  };
  return { previousClipSummary: collect(true), nextClipSummary: collect(false) };
}
