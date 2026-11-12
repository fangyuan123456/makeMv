/**
 * client/src/components/StoryGraphSvgDiagram.tsx
 * 纯原生自主绘制 SVG 互动文游拓扑图谱 (Pure SVG Architecture)
 * 零第三方图表库，数学推导分层 DAG 拓扑、贝塞尔连接线、动态高光与足迹追踪
 */

import React, { useMemo, useState } from 'react';
import type { TextGameNode } from '../types/index.js';
import {
  TopoNodeShape,
  TopoLegendIcon,
  getShapeAnchors,
  type TopoShapeKind,
} from './TopoNodeShape.js';

interface StoryGraphSvgDiagramProps {
  nodes: TextGameNode[];
  startNodeId?: string;
  currentNodeId?: string;
  visitedNodeIds?: string[];
  onSelectNode?: (node: TextGameNode) => void;
}

interface DagEdge {
  from: string;
  to: string;
  label?: string;
}

interface PosNode {
  node: TextGameNode;
  shape: TopoShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
}

function resolveStage2NodeShape(node: TextGameNode, isStart: boolean): TopoShapeKind {
  if (node.isEnding) return 'octagon';
  if (isStart) return 'stadium';
  if ((node.choices?.length || 0) > 1) return 'hexagon';
  return 'rect';
}

function truncateCompact(text: string, maxChars: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1))}…`;
}

export const StoryGraphSvgDiagram: React.FC<StoryGraphSvgDiagramProps> = ({
  nodes,
  startNodeId,
  currentNodeId,
  visitedNodeIds = [],
  onSelectNode,
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // 1. 提取所有有向边
  const { edges, startId } = useMemo(() => {
    const list: DagEdge[] = [];
    const validIds = new Set(nodes.map((n) => n.id));
    nodes.forEach((n) => {
      (n.choices || []).forEach((c) => {
        if (c.targetNodeId && validIds.has(c.targetNodeId)) {
          list.push({
            from: n.id,
            to: c.targetNodeId,
            label: c.text,
          });
        }
      });
    });
    return {
      edges: list,
      startId: startNodeId || (nodes[0] ? nodes[0].id : ''),
    };
  }, [nodes, startNodeId]);

  // 2. DAG 分层排序算法 (Kahn-style rank assignment)
  const layout = useMemo(() => {
    if (!nodes.length) {
      return { positionedNodes: [], edgesWithPos: [], width: 600, height: 300 };
    }

    const nodeIds = nodes.map((n) => n.id);
    const ids = new Set(nodeIds);
    const outgoing = new Map<string, string[]>();
    nodeIds.forEach((id) => outgoing.set(id, []));

    edges.forEach(({ from, to }) => {
      outgoing.get(from)?.push(to);
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

    // 几何尺寸配置（卡片瘦身，突出流向与几何区分）
    const NW = 178;
    const NH = 52;
    const COL_GAP = 84;
    const ROW_GAP = 32;
    const PAD_X = 44;
    const PAD_Y = 34;

    // 按列归类
    const cols = new Map<number, TextGameNode[]>();
    nodes.forEach((n) => {
      const col = rank.get(n.id) ?? 0;
      if (!cols.has(col)) cols.set(col, []);
      cols.get(col)!.push(n);
    });

    const sortedCols = [...cols.keys()].sort((a, b) => a - b);
    const maxRows = Math.max(...sortedCols.map((c) => cols.get(c)!.length), 1);

    const totalH = Math.max(400, PAD_Y * 2 + maxRows * (NH + ROW_GAP));
    const totalW = Math.max(750, PAD_X * 2 + sortedCols.length * (NW + COL_GAP));

    const posMap = new Map<string, PosNode>();
    const positionedNodes: PosNode[] = [];

    sortedCols.forEach((colIdx) => {
      const colNodes = cols.get(colIdx)!;
      const colH = colNodes.length * NH + (colNodes.length - 1) * ROW_GAP;
      const startY = (totalH - colH) / 2;

      colNodes.forEach((node, rowIdx) => {
        const shape = resolveStage2NodeShape(node, node.id === startId);
        const item: PosNode = {
          node,
          shape,
          x: PAD_X + colIdx * (NW + COL_GAP),
          y: startY + rowIdx * (NH + ROW_GAP),
          w: NW,
          h: NH,
          col: colIdx,
        };
        posMap.set(node.id, item);
        positionedNodes.push(item);
      });
    });

    // 计算连接线几何路径
    const edgesWithPos = edges
      .map((e) => {
        const fromNode = posMap.get(e.from);
        const toNode = posMap.get(e.to);
        if (!fromNode || !toNode) return null;

        const fromAnchors = getShapeAnchors(fromNode.shape, fromNode.w, fromNode.h);
        const toAnchors = getShapeAnchors(toNode.shape, toNode.w, toNode.h);
        const x1 = fromNode.x + fromAnchors.rightX;
        const y1 = fromNode.y + fromNode.h / 2;
        const x2 = toNode.x + toAnchors.leftX;
        const y2 = toNode.y + toNode.h / 2;

        let path: string;
        const isLoop = x2 <= x1;
        if (isLoop) {
          const arcY = Math.max(y1, y2) + 60;
          path = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + 50).toFixed(1)} ${arcY.toFixed(1)}, ${(x2 - 50).toFixed(1)} ${arcY.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        } else {
          const dx = Math.abs(x2 - x1);
          const cx1 = x1 + Math.max(30, dx * 0.45);
          const cx2 = x2 - Math.max(30, dx * 0.45);
          path = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cx1.toFixed(1)} ${y1.toFixed(1)}, ${cx2.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        }

        const isTraversed =
          visitedNodeIds.includes(e.from) && visitedNodeIds.includes(e.to);

        return {
          ...e,
          path,
          isTraversed,
        };
      })
      .filter(Boolean) as Array<DagEdge & { path: string; isTraversed: boolean }>;

    return { positionedNodes, edgesWithPos, width: totalW, height: totalH };
  }, [nodes, edges, startId, visitedNodeIds]);

  return (
    <div style={{ width: '100%', overflowX: 'auto', background: '#090d16', borderRadius: '8px', border: '1px solid var(--border-subtle)', padding: '10px' }}>
      <div className="topo-legend" style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="topo-legend-item">
          <TopoLegendIcon shape="stadium" stroke="#00d2ff" fill="#162234" /> 起点幕
        </span>
        <span className="topo-legend-item">
          <TopoLegendIcon shape="rect" stroke="#475569" fill="#121722" /> 剧情幕
        </span>
        <span className="topo-legend-item">
          <TopoLegendIcon shape="hexagon" stroke="#38bdf8" fill="#121c2c" /> 多分歧抉择
        </span>
        <span className="topo-legend-item">
          <TopoLegendIcon shape="octagon" stroke="#f59e0b" fill="#1c1722" doubleBorder /> 结局
        </span>
        <span className="topo-legend-tip">💡 点击节点跳转试玩该幕</span>
      </div>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ width: '100%', minWidth: `${layout.width}px`, height: 'auto', display: 'block' }}
      >
        <defs>
          <filter id="svgCurrentGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#00d2ff" floodOpacity="0.8" />
          </filter>
          <filter id="endingGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#f59e0b" floodOpacity="0.5" />
          </filter>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#475569" />
          </marker>
          <marker
            id="arrowActive"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#00d2ff" />
          </marker>
        </defs>

        {/* 绘制贝塞尔曲线连线 */}
        {layout.edgesWithPos.map((e, idx) => (
          <path
            key={`edge-${idx}`}
            d={e.path}
            fill="none"
            stroke={e.isTraversed ? '#00d2ff' : '#334155'}
            strokeWidth={e.isTraversed ? 2.5 : 1.5}
            strokeDasharray={e.isTraversed ? 'none' : '4 3'}
            markerEnd={e.isTraversed ? 'url(#arrowActive)' : 'url(#arrow)'}
            style={{ transition: 'all 0.3s' }}
          />
        ))}

        {/* 绘制文游节点（按语义区分形状，仅展示 ID + 简洁标题） */}
        {layout.positionedNodes.map(({ node, shape, x, y, w, h }) => {
          const isCurrent = node.id === currentNodeId;
          const isVisited = visitedNodeIds.includes(node.id);
          const isHovered = node.id === hoveredNodeId;

          let strokeColor = shape === 'hexagon' ? '#38bdf8' : '#334155';
          let fillColor = shape === 'hexagon' ? '#121c2c' : '#121722';
          let strokeWidth = 1.3;
          let filter: string | undefined;

          if (isCurrent) {
            strokeColor = '#00d2ff';
            fillColor = '#162234';
            strokeWidth = 2.4;
            filter = 'url(#svgCurrentGlow)';
          } else if (node.isEnding) {
            strokeColor = node.endingType === 'BE' ? '#ef4444' : '#f59e0b';
            fillColor = '#1c1722';
            strokeWidth = 1.8;
            filter = 'url(#endingGlow)';
          } else if (isVisited) {
            strokeColor = '#10b981';
            fillColor = '#101d22';
            strokeWidth = 1.6;
          }

          if (isHovered && !isCurrent) {
            strokeColor = '#38bdf8';
            strokeWidth = 2;
          }

          const shortTag =
            node.id === startId
              ? '起'
              : node.isEnding
                ? node.endingType || '终'
                : isVisited
                  ? '✓'
                  : undefined;

          return (
            <g
              key={node.id}
              transform={`translate(${x}, ${y})`}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              onClick={() => onSelectNode?.(node)}
            >
              <title>{`[${node.id}] ${node.title}\n${node.choices?.length ? `${node.choices.length} 个抉择走向` : '剧情终局'}`}</title>

              <TopoNodeShape
                shape={shape}
                w={w}
                h={h}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                doubleBorder={Boolean(node.isEnding)}
                filter={filter}
              />

              <text
                x={w / 2}
                y={18}
                fill={isCurrent ? '#00d2ff' : '#94a3b8'}
                fontSize="10"
                fontWeight="700"
                fontFamily="monospace"
                textAnchor="middle"
              >
                {shortTag ? `${truncateCompact(node.id, 10)} · ${shortTag}` : truncateCompact(node.id, 13)}
              </text>

              <text
                x={w / 2}
                y={37}
                fill="#ffffff"
                fontSize="12"
                fontWeight="700"
                fontFamily="sans-serif"
                textAnchor="middle"
              >
                {truncateCompact(node.title, 10)}
              </text>

              {isCurrent && (
                <circle cx={14} cy={h / 2} r="4" fill="#00d2ff">
                  <animate attributeName="r" values="3;5.5;3" dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
