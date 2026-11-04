import React, { useMemo } from 'react';

export interface StoryNode {
  id: string;
  type?: string;
  title: string;
  summary?: string;
  location?: string;
  characters?: string[];
  estimatedDurationSec?: number;
}

export interface StoryChoice {
  id?: string;
  fromNodeId: string;
  toNodeId: string;
  choiceText?: string;
  timeoutSeconds?: number;
}

export interface InteractiveStoryGraph {
  startNodeId?: string;
  rootNodeId?: string;
  nodes: StoryNode[];
  choices?: StoryChoice[];
}

interface StoryGraphSvgDiagramProps {
  graph: InteractiveStoryGraph;
  className?: string;
  onClick?: () => void;
}

export default function StoryGraphSvgDiagram({
  graph,
  className = '',
  onClick,
}: StoryGraphSvgDiagramProps) {
  const nodes = useMemo(() => graph?.nodes || [], [graph?.nodes]);

  const choices: StoryChoice[] = useMemo(() => {
    // 优先使用顶层 choices 数组
    if (graph?.choices && graph.choices.length > 0) return graph.choices;
    // 降级：从每个节点的嵌套 choices 中提取（兼容 story_bible.json 格式）
    const list: StoryChoice[] = [];
    nodes.forEach((n: any) => {
      if (Array.isArray(n.choices)) {
        n.choices.forEach((c: any, idx: number) => {
          const toNodeId = c.targetNodeId || c.toNodeId;
          if (!toNodeId) return; // 跳过无效连线
          list.push({
            id: c.id || `${n.id}_c_${idx}`,
            fromNodeId: n.id,
            toNodeId,
            choiceText: c.text || c.choiceText || '分支路线',
          });
        });
      }
    });
    return list;
  }, [graph?.choices, nodes]);

  // 分层 DAG 布局算法（刚性防护，任何异常均安全降级）
  const layout = useMemo(() => {
    if (nodes.length === 0) {
      return { nodesWithPos: [], connections: [], width: 800, height: 400 };
    }

    try {
      // 兼容 rootNodeId（story_bible 格式）和 startNodeId
      const startId = (graph as any)?.rootNodeId || graph?.startNodeId || nodes[0]?.id;
      const outgoing = new Map<string, string[]>();
      nodes.forEach((n) => outgoing.set(n.id, []));
      choices.forEach((c) => {
        if (c.toNodeId && outgoing.has(c.fromNodeId)) {
          outgoing.get(c.fromNodeId)!.push(c.toNodeId);
        }
      });

      const rankMap = new Map<string, number>();
      rankMap.set(startId, 0);

      const queue = [startId];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        const currRank = rankMap.get(curr) || 0;
        const neighbors = outgoing.get(curr) || [];
        for (const nxt of neighbors) {
          const existing = rankMap.get(nxt);
          const newRank = currRank + 1;
          if (existing === undefined || newRank > existing) {
            rankMap.set(nxt, newRank);
            queue.push(nxt);
          }
        }
      }

      nodes.forEach((n) => {
        if (!rankMap.has(n.id)) rankMap.set(n.id, 1);
      });

      const columns: Map<number, StoryNode[]> = new Map();
      nodes.forEach((n) => {
        const col = rankMap.get(n.id) || 0;
        if (!columns.has(col)) columns.set(col, []);
        columns.get(col)!.push(n);
      });

      const sortedCols = Array.from(columns.keys()).sort((a, b) => a - b);
      const nodeWidth = 220;
      const nodeHeight = 110;
      const colGap = 160;
      const rowGap = 50;
      const paddingX = 50;
      const paddingY = 40;

      let maxRowCount = 1;
      sortedCols.forEach((col) => {
        const count = columns.get(col)?.length || 0;
        if (count > maxRowCount) maxRowCount = count;
      });

      const totalHeight = Math.max(480, paddingY * 2 + maxRowCount * (nodeHeight + rowGap));
      const totalWidth = Math.max(760, paddingY * 2 + sortedCols.length * (nodeWidth + colGap));

      const nodesWithPos: Array<{
        node: StoryNode;
        x: number;
        y: number;
        w: number;
        h: number;
      }> = [];
      const posMap = new Map<string, { x: number; y: number; w: number; h: number }>();

      sortedCols.forEach((colIdx) => {
        const colNodes = columns.get(colIdx) || [];
        const colHeight = colNodes.length * nodeHeight + (colNodes.length - 1) * rowGap;
        const startY = (totalHeight - colHeight) / 2;

        colNodes.forEach((node, rowIdx) => {
          const x = paddingX + colIdx * (nodeWidth + colGap);
          const y = startY + rowIdx * (nodeHeight + rowGap);
          const item = { node, x, y, w: nodeWidth, h: nodeHeight };
          nodesWithPos.push(item);
          posMap.set(node.id, item);
        });
      });

      const connections: Array<{
        d: string;
        label?: string;
        labelX: number;
        labelY: number;
      }> = [];

      choices.forEach((c) => {
        const from = posMap.get(c.fromNodeId);
        const to = posMap.get(c.toNodeId);
        if (!from || !to) return;

        const startX = from.x + from.w;
        const startY = from.y + from.h / 2;
        const endX = to.x;
        const endY = to.y + to.h / 2;

        const c1X = startX + (endX - startX) * 0.45;
        const c1Y = startY;
        const c2X = startX + (endX - startX) * 0.55;
        const c2Y = endY;

        const pathData = `M ${startX} ${startY} C ${c1X} ${c1Y}, ${c2X} ${c2Y}, ${endX} ${endY}`;
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;

        connections.push({
          d: pathData,
          label: c.choiceText,
          labelX: midX,
          labelY: midY,
        });
      });

      return { nodesWithPos, connections, width: totalWidth, height: totalHeight };
    } catch (err) {
      console.error('[StoryGraphSvgDiagram] DAG 布局计算异常，安全降级：', err);
      return { nodesWithPos: [], connections: [], width: 800, height: 400 };
    }
  }, [nodes, choices, graph]);

  return (
    <div
      onClick={onClick}
      className={`w-full h-full min-h-[360px] max-w-full relative select-none flex items-center justify-center ${className}`}
    >
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full block"
        style={{ minHeight: '340px', width: '100%', height: '100%' }}
      >
        <defs>
          {/* 背景网格 */}
          <pattern id="diag-grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" strokeWidth="0.5" strokeOpacity="0.5" />
          </pattern>

          {/* 连线渐变 */}
          <linearGradient id="line-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.9" />
          </linearGradient>

          {/* 终点箭头标记 */}
          <marker
            id="diag-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#a855f7" />
          </marker>
        </defs>

        {/* 底层网格背景 */}
        <rect width="100%" height="100%" fill="#090d16" />
        <rect width="100%" height="100%" fill="url(#diag-grid)" />

        {/* 1. 连线层 */}
        <g className="connections-layer">
          {layout.connections.map((conn, idx) => (
            <g key={idx}>
              <path
                d={conn.d}
                fill="none"
                stroke="url(#line-gradient)"
                strokeWidth="2.5"
                markerEnd="url(#diag-arrow)"
                strokeDasharray="none"
              />
              {conn.label && (
                <g transform={`translate(${conn.labelX}, ${conn.labelY})`}>
                  <rect
                    x="-45"
                    y="-10"
                    width="90"
                    height="20"
                    rx="10"
                    fill="#0f172a"
                    stroke="#4338ca"
                    strokeWidth="1"
                  />
                  <text
                    x="0"
                    y="3"
                    textAnchor="middle"
                    fill="#c7d2fe"
                    fontSize="9"
                    fontWeight="bold"
                  >
                    {conn.label.length > 7 ? conn.label.slice(0, 6) + '..' : conn.label}
                  </text>
                </g>
              )}
            </g>
          ))}
        </g>

        {/* 2. 节点层 */}
        <g className="nodes-layer">
          {layout.nodesWithPos.map(({ node, x, y, w, h }) => {
            const isEnding =
              node.type?.includes('end') ||
              node.title?.includes('终') ||
              node.title?.includes('结局');
            const isDecision = (node as any)?.choices?.length > 1;

            const badgeText = isEnding ? '终局结局' : isDecision ? '核心抉择' : '剧情节点';
            const badgeBg = isEnding ? '#7f1d1d' : isDecision ? '#312e81' : '#1e293b';
            const badgeBorder = isEnding ? '#ef4444' : isDecision ? '#6366f1' : '#475569';
            const badgeColor = isEnding ? '#fca5a5' : isDecision ? '#c7d2fe' : '#94a3b8';

            const cardBorder = isEnding ? '#dc2626' : isDecision ? '#4f46e5' : '#334155';

            return (
              <g
                key={node.id}
                transform={`translate(${x}, ${y})`}
                className="transition-all duration-200"
              >
                {/* 节点外阴影与发光 */}
                <rect
                  x="-2"
                  y="-2"
                  width={w + 4}
                  height={h + 4}
                  rx="14"
                  fill="none"
                  stroke={cardBorder}
                  strokeWidth="1"
                  strokeOpacity="0.4"
                />

                {/* 节点卡片主体 */}
                <rect
                  x="0"
                  y="0"
                  width={w}
                  height={h}
                  rx="12"
                  fill="#0f172a"
                  stroke={cardBorder}
                  strokeWidth="1.8"
                />

                {/* 顶部标题区 */}
                <text
                  x="14"
                  y="26"
                  fill="#f8fafc"
                  fontSize="12"
                  fontWeight="bold"
                >
                  {node.title?.length > 11 ? node.title.slice(0, 10) + '...' : node.title || node.id}
                </text>

                {/* 标签 Badge */}
                <g transform={`translate(${w - 75}, 14)`}>
                  <rect
                    width="62"
                    height="17"
                    rx="8.5"
                    fill={badgeBg}
                    stroke={badgeBorder}
                    strokeWidth="1"
                  />
                  <text
                    x="31"
                    y="11.5"
                    textAnchor="middle"
                    fill={badgeColor}
                    fontSize="8.5"
                    fontWeight="bold"
                  >
                    {badgeText}
                  </text>
                </g>

                {/* 分割线 */}
                <line x1="14" y1="36" x2={w - 14} y2="36" stroke="#1e293b" strokeWidth="1" />

                {/* 摘要文案 (自动截断两行) */}
                <text x="14" y="54" fill="#94a3b8" fontSize="10">
                  {(node.summary || '').slice(0, 16)}
                </text>
                <text x="14" y="70" fill="#94a3b8" fontSize="10">
                  {(node.summary || '').slice(16, 32)}
                  {(node.summary || '').length > 32 ? '...' : ''}
                </text>

                {/* 底部微信息 */}
                <text x="14" y="94" fill="#64748b" fontSize="9" fontFamily="monospace">
                  #{node.id}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
