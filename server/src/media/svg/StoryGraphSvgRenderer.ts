/**
 * media/svg/StoryGraphSvgRenderer.ts
 * 纯原生自主绘制 SVG 故事拓扑图与交互 HUD 渲染器 (Pure SVG Architecture)
 * 彻底杜绝第三方重型拓扑图表库，纯数学计算节点与贝塞尔曲线
 */

import type { TextGameArtifact, TextGameNode } from '../../agents/text-game/schema.js';

export interface DagEdge {
  from: string;
  to: string;
  label?: string;
}

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

  if (startId && ids.has(startId) && !queue.includes(startId)) {
    indeg.set(startId, 0);
    queue.unshift(startId);
  }

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

export class StoryGraphSvgRenderer {
  private static readonly NW = 240;
  private static readonly NH = 120;
  private static readonly COL_GAP = 160;
  private static readonly ROW_GAP = 60;
  private static readonly PAD_X = 60;
  private static readonly PAD_Y = 50;

  /**
   * 将 TextGameArtifact 或节点列表渲染为工业级高美感 SVG 拓扑网络
   */
  public static renderToSvg(artifact: TextGameArtifact): string {
    const nodes = artifact.nodes || [];
    if (nodes.length === 0) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
        <rect width="100%" height="100%" fill="#090d16" />
        <text x="400" y="200" fill="#94a3b8" font-size="16" text-anchor="middle">图谱暂无节点</text>
      </svg>`;
    }

    const startId = artifact.startNodeId || nodes[0].id;
    const nodeIds = nodes.map((n) => n.id);

    // 提取所有边
    const edges: DagEdge[] = [];
    nodes.forEach((node) => {
      (node.choices || []).forEach((c) => {
        if (c.targetNodeId) {
          edges.push({
            from: node.id,
            to: c.targetNodeId,
            label: c.text,
          });
        }
      });
    });

    // 计算分层列号
    const rankMap = computeDagRanks(nodeIds, edges, startId);

    // 按列归类
    const cols = new Map<number, TextGameNode[]>();
    nodes.forEach((n) => {
      const col = rankMap.get(n.id) ?? 0;
      if (!cols.has(col)) cols.set(col, []);
      cols.get(col)!.push(n);
    });

    const sortedCols = [...cols.keys()].sort((a, b) => a - b);
    const maxRows = Math.max(...sortedCols.map((c) => cols.get(c)!.length), 1);

    const totalH = Math.max(500, this.PAD_Y * 2 + maxRows * (this.NH + this.ROW_GAP));
    const totalW = Math.max(900, this.PAD_X * 2 + sortedCols.length * (this.NW + this.COL_GAP));

    // 计算各节点坐标
    type PosNode = { node: TextGameNode; x: number; y: number; w: number; h: number };
    const posMap = new Map<string, PosNode>();
    const positionedNodes: PosNode[] = [];

    sortedCols.forEach((colIdx) => {
      const colNodes = cols.get(colIdx)!;
      const colH = colNodes.length * this.NH + (colNodes.length - 1) * this.ROW_GAP;
      const startY = (totalH - colH) / 2;

      colNodes.forEach((node, rowIdx) => {
        const item: PosNode = {
          node,
          x: this.PAD_X + colIdx * (this.NW + this.COL_GAP),
          y: startY + rowIdx * (this.NH + this.ROW_GAP),
          w: this.NW,
          h: this.NH,
        };
        positionedNodes.push(item);
        posMap.set(node.id, item);
      });
    });

    // 构建贝塞尔曲线与标签
    const pathsHtml: string[] = [];
    edges.forEach((edge) => {
      const from = posMap.get(edge.from);
      const to = posMap.get(edge.to);
      if (!from || !to) return;

      const sx = from.x + from.w;
      const sy = from.y + from.h / 2;
      const ex = to.x;
      const ey = to.y + to.h / 2;
      const cp1x = sx + (ex - sx) * 0.45;
      const cp2x = sx + (ex - sx) * 0.55;

      const d = `M ${sx} ${sy} C ${cp1x} ${sy}, ${cp2x} ${ey}, ${ex} ${ey}`;
      const lx = (sx + ex) / 2;
      const ly = (sy + ey) / 2;

      const labelText = (edge.label || '').length > 9 ? edge.label!.slice(0, 8) + '..' : edge.label || '';

      pathsHtml.push(`
        <path d="${d}" fill="none" stroke="url(#sg-line-grad)" stroke-width="2.5" marker-end="url(#sg-arrow)" />
        ${
          labelText
            ? `<g transform="translate(${lx}, ${ly})">
                <rect x="-45" y="-11" width="90" height="22" rx="11" fill="#0f172a" stroke="#4338ca" stroke-width="1.2" />
                <text x="0" y="4" text-anchor="middle" fill="#c7d2fe" font-size="10" font-family="system-ui, sans-serif" font-weight="600">${this.escapeXml(
                  labelText
                )}</text>
              </g>`
            : ''
        }
      `);
    });

    // 构建节点卡片
    const nodesHtml: string[] = [];
    positionedNodes.forEach(({ node, x, y, w, h }) => {
      const isStart = node.id === startId;
      const isEnding = !!node.isEnding;
      const borderColor = isStart ? '#38bdf8' : isEnding ? '#ec4899' : '#334155';
      const badgeBg = isStart ? '#0369a1' : isEnding ? '#9d174d' : '#1e293b';
      const badgeText = isStart ? 'START' : isEnding ? (node.endingType || 'ENDING') : 'SCENE';

      const safeTitle = this.escapeXml(node.title || node.id);
      const previewText = this.escapeXml(
        (node.narrativeText || '').slice(0, 36) + ((node.narrativeText || '').length > 36 ? '...' : '')
      );

      nodesHtml.push(`
        <g transform="translate(${x}, ${y})">
          <!-- 节点背景卡片 -->
          <rect width="${w}" height="${h}" rx="12" fill="#0f172a" stroke="${borderColor}" stroke-width="2" />
          
          <!-- 顶部状态胶囊 -->
          <rect x="12" y="12" width="60" height="18" rx="9" fill="${badgeBg}" />
          <text x="42" y="24" fill="#ffffff" font-size="9" font-family="system-ui, sans-serif" font-weight="bold" text-anchor="middle">${badgeText}</text>
          
          <!-- 节点 ID 提示 -->
          <text x="${w - 14}" y="25" fill="#64748b" font-size="10" font-family="monospace" text-anchor="end">${this.escapeXml(
        node.id
      )}</text>
          
          <!-- 节点标题 -->
          <text x="14" y="52" fill="#f8fafc" font-size="13" font-family="system-ui, sans-serif" font-weight="bold">${safeTitle}</text>
          
          <!-- 剧本前瞻 -->
          <text x="14" y="74" fill="#94a3b8" font-size="10.5" font-family="system-ui, sans-serif">${previewText}</text>
          
          <!-- 分支统计指示器 -->
          <line x1="12" y1="${h - 26}" x2="${w - 12}" y2="${h - 26}" stroke="#1e293b" stroke-width="1" />
          <circle cx="20" cy="${h - 13}" r="4" fill="#6366f1" />
          <text x="30" y="${h - 10}" fill="#818cf8" font-size="9.5" font-family="system-ui, sans-serif">${
        (node.choices || []).length
      } 个后续抉择分支</text>
        </g>
      `);
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" height="100%" style="background-color: #090d16;">
  <defs>
    <!-- 网格背景 -->
    <pattern id="sg-grid" width="30" height="30" patternUnits="userSpaceOnUse">
      <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" stroke-width="0.6" stroke-opacity="0.6" />
    </pattern>
    <!-- 连线线性渐变 -->
    <linearGradient id="sg-line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.8" />
      <stop offset="100%" stop-color="#a855f7" stop-opacity="1" />
    </linearGradient>
    <!-- 连线箭头 -->
    <marker id="sg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#a855f7" />
    </marker>
  </defs>

  <!-- 背景层 -->
  <rect width="100%" height="100%" fill="#090d16" />
  <rect width="100%" height="100%" fill="url(#sg-grid)" />

  <!-- 连线层 -->
  <g id="connections-layer">
    ${pathsHtml.join('\n')}
  </g>

  <!-- 节点层 -->
  <g id="nodes-layer">
    ${nodesHtml.join('\n')}
  </g>
</svg>`;
  }

  private static escapeXml(unsafe: string): string {
    return (unsafe || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
