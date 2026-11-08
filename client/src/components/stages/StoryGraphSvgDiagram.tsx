import { useMemo } from 'react';
import { computeDagRanks } from './dagLayout';

export interface StoryNode {
  id: string;
  type?: string;
  title: string;
  summary?: string;
  isEnding?: boolean;
  endingType?: string;
  choices?: Array<{
    targetNodeId?: string;
    toNodeId?: string;
    text?: string;
    choiceText?: string;
    id?: string;
  }>;
}

export interface StoryChoice {
  id?: string;
  fromNodeId: string;
  toNodeId: string;
  choiceText?: string;
}

export interface InteractiveStoryGraph {
  startNodeId?: string;
  rootNodeId?: string;
  nodes: StoryNode[];
  choices?: StoryChoice[];
}

interface Props {
  graph: InteractiveStoryGraph;
  className?: string;
  onClick?: () => void;
}

/** 节点宽高与布局常量 */
const NW = 220;
const NH = 110;
const COL_GAP = 160;
const ROW_GAP = 50;
const PAD_X = 50;
const PAD_Y = 40;

export default function StoryGraphSvgDiagram({ graph, className = '', onClick }: Props) {
  // 1. 提取 nodes
  const nodes: StoryNode[] = useMemo(() => graph?.nodes ?? [], [graph]);

  // 2. 提取 choices（兼容顶层数组 / 节点内嵌两种格式）
  const choices: StoryChoice[] = useMemo(() => {
    if (Array.isArray(graph?.choices) && graph.choices.length > 0) {
      return graph.choices;
    }
    const list: StoryChoice[] = [];
    nodes.forEach((n) => {
      if (!Array.isArray(n.choices)) return;
      n.choices.forEach((c, idx) => {
        const toId = c.targetNodeId ?? c.toNodeId ?? '';
        if (!toId) return;
        list.push({
          id: c.id ?? `${n.id}_c${idx}`,
          fromNodeId: n.id,
          toNodeId: toId,
          choiceText: c.text ?? c.choiceText ?? '分支',
        });
      });
    });
    return list;
  }, [graph, nodes]);

  // 3. DAG 分层布局
  const layout = useMemo(() => {
    const empty = { nodesWithPos: [], connections: [], width: 800, height: 480 };
    if (nodes.length === 0) return empty;

    const startId = graph?.rootNodeId ?? graph?.startNodeId ?? nodes[0].id;

    // 拓扑序分层（自环/环安全）：旧的最长路径 BFS 遇自环会无限入队
    const rank = computeDagRanks(
      nodes.map((n) => n.id),
      choices.map((c) => ({ from: c.fromNodeId, to: c.toNodeId })),
      startId
    );

    // 按列分组
    const cols = new Map<number, StoryNode[]>();
    nodes.forEach((n) => {
      const c = rank.get(n.id) ?? 0;
      if (!cols.has(c)) cols.set(c, []);
      cols.get(c)!.push(n);
    });

    const sortedCols = [...cols.keys()].sort((a, b) => a - b);
    const maxRows = Math.max(...sortedCols.map((c) => cols.get(c)!.length), 1);

    const totalH = Math.max(480, PAD_Y * 2 + maxRows * (NH + ROW_GAP));
    const totalW = Math.max(760, PAD_X * 2 + sortedCols.length * (NW + COL_GAP));

    // 计算节点位置
    type PosNode = { node: StoryNode; x: number; y: number; w: number; h: number };
    const nodesWithPos: PosNode[] = [];
    const posMap = new Map<string, PosNode>();

    sortedCols.forEach((colIdx) => {
      const colNodes = cols.get(colIdx)!;
      const colH = colNodes.length * NH + (colNodes.length - 1) * ROW_GAP;
      const startY = (totalH - colH) / 2;
      colNodes.forEach((node, rowIdx) => {
        const item: PosNode = {
          node,
          x: PAD_X + colIdx * (NW + COL_GAP),
          y: startY + rowIdx * (NH + ROW_GAP),
          w: NW,
          h: NH,
        };
        nodesWithPos.push(item);
        posMap.set(node.id, item);
      });
    });

    // 计算连线
    type Conn = { d: string; label?: string; lx: number; ly: number };
    const connections: Conn[] = [];
    choices.forEach((c) => {
      const from = posMap.get(c.fromNodeId);
      const to = posMap.get(c.toNodeId);
      if (!from || !to) return;

      const sx = from.x + from.w;
      const sy = from.y + from.h / 2;
      const ex = to.x;
      const ey = to.y + to.h / 2;
      const cp1x = sx + (ex - sx) * 0.45;
      const cp2x = sx + (ex - sx) * 0.55;

      connections.push({
        d: `M ${sx} ${sy} C ${cp1x} ${sy}, ${cp2x} ${ey}, ${ex} ${ey}`,
        label: c.choiceText,
        lx: (sx + ex) / 2,
        ly: (sy + ey) / 2,
      });
    });

    return { nodesWithPos, connections, width: totalW, height: totalH };
  }, [nodes, choices, graph]);

  // 4. 渲染
  return (
    <div
      onClick={onClick}
      className={`w-full h-full min-h-[360px] select-none flex items-center justify-center ${className}`}
    >
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', minHeight: '340px', display: 'block' }}
      >
        <defs>
          <pattern id="sg-grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" strokeWidth="0.5" strokeOpacity="0.5" />
          </pattern>
          <linearGradient id="sg-line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="1" />
          </linearGradient>
          <marker id="sg-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#a855f7" />
          </marker>
        </defs>

        {/* 背景 */}
        <rect width="100%" height="100%" fill="#090d16" />
        <rect width="100%" height="100%" fill="url(#sg-grid)" />

        {/* 连线层 */}
        <g>
          {layout.connections.map((conn, i) => (
            <g key={i}>
              <path
                d={conn.d}
                fill="none"
                stroke="url(#sg-line-grad)"
                strokeWidth="2.5"
                markerEnd="url(#sg-arrow)"
              />
              {conn.label && (
                <g transform={`translate(${conn.lx},${conn.ly})`}>
                  <rect x="-45" y="-10" width="90" height="20" rx="10" fill="#0f172a" stroke="#4338ca" strokeWidth="1" />
                  <text x="0" y="4" textAnchor="middle" fill="#c7d2fe" fontSize="9" fontWeight="bold">
                    {conn.label.length > 7 ? conn.label.slice(0, 6) + '..' : conn.label}
                  </text>
                </g>
              )}
            </g>
          ))}
        </g>

        {/* 节点层 */}
        <g>
          {layout.nodesWithPos.map(({ node, x, y, w, h }) => {
            const isEnding = node.isEnding || node.type?.includes('end')
              || node.title?.includes('终') || node.title?.includes('结局');
            const isDecision = Array.isArray(node.choices) && node.choices.length > 1;

            const border = isEnding ? '#dc2626' : isDecision ? '#4f46e5' : '#334155';
            const badgeBg = isEnding ? '#7f1d1d' : isDecision ? '#312e81' : '#1e293b';
            const badgeBorder = isEnding ? '#ef4444' : isDecision ? '#6366f1' : '#475569';
            const badgeColor = isEnding ? '#fca5a5' : isDecision ? '#c7d2fe' : '#94a3b8';
            const badgeText = isEnding ? '终局结局' : isDecision ? '核心抉择' : '剧情节点';

            const summary = node.summary ?? '';

            return (
              <g key={node.id} transform={`translate(${x},${y})`}>
                {/* 光晕边框 */}
                <rect x="-2" y="-2" width={w + 4} height={h + 4} rx="14"
                  fill="none" stroke={border} strokeWidth="1" strokeOpacity="0.3" />
                {/* 卡片主体 */}
                <rect x="0" y="0" width={w} height={h} rx="12"
                  fill="#0f172a" stroke={border} strokeWidth="1.8" />
                {/* 标题 */}
                <text x="14" y="26" fill="#f8fafc" fontSize="12" fontWeight="bold">
                  {node.title.length > 11 ? node.title.slice(0, 10) + '…' : node.title}
                </text>
                {/* Badge */}
                <g transform={`translate(${w - 75},14)`}>
                  <rect width="62" height="17" rx="8.5" fill={badgeBg} stroke={badgeBorder} strokeWidth="1" />
                  <text x="31" y="11.5" textAnchor="middle" fill={badgeColor} fontSize="8.5" fontWeight="bold">
                    {badgeText}
                  </text>
                </g>
                {/* 分隔线 */}
                <line x1="14" y1="36" x2={w - 14} y2="36" stroke="#1e293b" strokeWidth="1" />
                {/* 摘要 */}
                <text x="14" y="54" fill="#94a3b8" fontSize="10">{summary.slice(0, 16)}</text>
                <text x="14" y="70" fill="#94a3b8" fontSize="10">
                  {summary.slice(16, 32)}{summary.length > 32 ? '…' : ''}
                </text>
                {/* ID */}
                <text x="14" y="94" fill="#64748b" fontSize="9" fontFamily="monospace">#{node.id}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
