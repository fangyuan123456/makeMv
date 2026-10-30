'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  GitBranch,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  Zap,
  ShieldAlert,
  Trophy,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Search,
  MessageSquare,
  Briefcase,
  Layers,
  X,
  Compass,
} from 'lucide-react';

export interface StoryNode {
  id: string;
  type: string;
  title: string;
  summary: string;
  location?: string;
  characters?: string[];
  estimatedDurationSec?: number;
  interactionMode?: string;
  hotspots?: any[];
  commMessage?: any;
  evidencePresent?: any;
}

export interface StoryChoice {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  choiceText: string;
  timeoutSeconds?: number;
  isTimeoutDefault?: boolean;
}

export interface GraphValidation {
  isPass: boolean;
  convergenceRate: number;
  totalEstimatedDurationSec: number;
  issues: string[];
  warnings: string[];
}

export interface InteractiveStoryGraph {
  startNodeId: string;
  nodes: StoryNode[];
  choices: StoryChoice[];
  validation?: GraphValidation;
  systems?: any;
}

interface InteractiveTopologyCanvasProps {
  graph?: InteractiveStoryGraph;
  onSelectNode?: (node: StoryNode) => void;
  className?: string;
}

interface LayoutNode {
  node: StoryNode;
  x: number;
  y: number;
  col: number;
  row: number;
}

export default function InteractiveTopologyCanvas({
  graph,
  onSelectNode,
  className = '',
}: InteractiveTopologyCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.85);
  const [pan, setPan] = useState({ x: 30, y: 30 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const nodes = graph?.nodes || [];
  const choices = graph?.choices || [];
  const validation = graph?.validation;

  // 1. 拓扑分层布局算法 (Topological Ranking & Coordinate Layout)
  const layout = useMemo(() => {
    if (!nodes.length) return { layoutNodes: [], width: 1200, height: 600, nodeMap: new Map() };

    const startId = graph?.startNodeId || nodes[0]?.id;
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    nodes.forEach((n) => {
      outgoing.set(n.id, []);
      incoming.set(n.id, []);
    });
    choices.forEach((c) => {
      if (outgoing.has(c.fromNodeId)) outgoing.get(c.fromNodeId)!.push(c.toNodeId);
      if (incoming.has(c.toNodeId)) incoming.get(c.toNodeId)!.push(c.fromNodeId);
    });

    // 计算每个节点的拓扑列级 (Column / Rank)
    const rankMap = new Map<string, number>();
    rankMap.set(startId, 0);

    // BFS 广度搜索分层
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

    // 容错兜底：未连通节点赋 rank 1
    nodes.forEach((n) => {
      if (!rankMap.has(n.id)) {
        rankMap.set(n.id, 1);
      }
    });

    // 按列聚合节点
    const columns: Map<number, StoryNode[]> = new Map();
    nodes.forEach((n) => {
      const col = rankMap.get(n.id) || 0;
      if (!columns.has(col)) columns.set(col, []);
      columns.get(col)!.push(n);
    });

    const sortedCols = Array.from(columns.keys()).sort((a, b) => a - b);
    const layoutNodes: LayoutNode[] = [];
    const nodeMap = new Map<string, LayoutNode>();

    const colSpacing = 480;
    const startX = 60;
    const baseY = 60;

    sortedCols.forEach((colIdx) => {
      const colNodes = columns.get(colIdx) || [];
      const count = colNodes.length;
      const rowSpacing = count > 3 ? 160 : count === 3 ? 190 : count === 2 ? 220 : 250;
      const totalColHeight = count * rowSpacing;
      const colOffsetY = Math.max(0, (560 - totalColHeight) / 2);

      colNodes.forEach((node, rowIdx) => {
        const x = startX + colIdx * colSpacing;
        const y = baseY + colOffsetY + rowIdx * rowSpacing;
        const ln: LayoutNode = { node, x, y, col: colIdx, row: rowIdx };
        layoutNodes.push(ln);
        nodeMap.set(node.id, ln);
      });
    });

    const maxCol = sortedCols[sortedCols.length - 1] || 0;
    const canvasWidth = startX + (maxCol + 1) * colSpacing + 160;
    const canvasHeight = Math.max(720, ...layoutNodes.map((n) => n.y + 220));

    return { layoutNodes, width: canvasWidth, height: canvasHeight, nodeMap };
  }, [nodes, choices, graph?.startNodeId]);

  // 2. 交互控制 (拖拽漫游与缩放)
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.topology-node-card')) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  };

  const handleMouseUp = () => setIsPanning(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setScale((prev) => Math.min(1.8, Math.max(0.4, prev * zoomFactor)));
  };

  const fitToView = () => {
    if (!containerRef.current) return;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;
    const scaleX = (containerW - 80) / layout.width;
    const scaleY = (containerH - 80) / layout.height;
    const newScale = Math.min(1.1, Math.max(0.45, Math.min(scaleX, scaleY)));
    setScale(newScale);
    setPan({
      x: Math.max(20, (containerW - layout.width * newScale) / 2),
      y: Math.max(20, (containerH - layout.height * newScale) / 2),
    });
  };

  useEffect(() => {
    fitToView();
  }, [layout.width, layout.height]);

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  // 辅助样式判定
  const getNodeVisualConfig = (type: string, isBadEnd: boolean) => {
    if (isBadEnd || type === 'bad_end') {
      return {
        cardBorder: 'border-rose-400 bg-rose-950/80 hover:border-rose-300',
        badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        label: '💀 即死结局',
        glow: 'shadow-rose-900/40',
        headerText: 'text-rose-200',
        icon: ShieldAlert,
      };
    }
    if (type === 'true_end') {
      return {
        cardBorder: 'border-amber-400 bg-amber-950/80 hover:border-amber-300',
        badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        label: '🏆 胜利结局',
        glow: 'shadow-amber-900/40',
        headerText: 'text-amber-200',
        icon: Trophy,
      };
    }
    if (type === 'investigation') {
      return {
        cardBorder: 'border-cyan-400 bg-cyan-950/80 hover:border-cyan-300',
        badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
        label: '🔍 点触搜证',
        glow: 'shadow-cyan-900/40',
        headerText: 'text-cyan-200',
        icon: Search,
      };
    }
    if (type === 'decision' || type === 'qte') {
      return {
        cardBorder: 'border-indigo-400 bg-indigo-950/80 hover:border-indigo-300',
        badgeBg: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
        label: '⚡ 抉择分水岭',
        glow: 'shadow-indigo-900/40',
        headerText: 'text-indigo-200',
        icon: Zap,
      };
    }
    return {
      cardBorder: 'border-slate-500 bg-slate-900/90 hover:border-indigo-400',
      badgeBg: 'bg-slate-700/50 text-slate-300 border-slate-600',
      label: '🎬 剧情主线',
      glow: 'shadow-slate-900/40',
      headerText: 'text-slate-100',
      icon: Clock,
    };
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      className={`relative w-full h-full overflow-hidden bg-slate-950 select-none cursor-grab active:cursor-grabbing ${className}`}
    >
      {/* 科技感网格与发光暗背景 */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b1a_1px,transparent_1px),linear-gradient(to_bottom,#1e293b1a_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.12),transparent_70%)] pointer-events-none" />

      {/* 顶部悬浮控制栏 */}
      <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-700/80 shadow-xl backdrop-blur-md text-xs">
          <div className="flex items-center gap-1.5 text-indigo-300 font-bold">
            <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
            <span>网状故事拓扑全景图</span>
          </div>
          <span className="text-slate-600">|</span>
          <span className="text-slate-300 font-mono text-[11px]">
            {nodes.length} 个节点 · {choices.length} 条分支
          </span>
          {validation && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                validation.isPass
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              质检通过 (收束率 {((validation.convergenceRate || 0) * 100).toFixed(0)}%)
            </span>
          )}
        </div>

        {/* 缩放与居中工具条 */}
        <div className="pointer-events-auto flex items-center gap-1.5 p-1 rounded-xl bg-slate-900/90 border border-slate-700/80 shadow-xl backdrop-blur-md text-slate-300">
          <button
            onClick={() => setScale((s) => Math.min(1.8, s * 1.15))}
            className="p-1.5 rounded-lg hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
            title="放大 (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono px-1 font-bold text-slate-400 min-w-[42px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.max(0.4, s * 0.85))}
            className="p-1.5 rounded-lg hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
            title="缩小 (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={fitToView}
            className="p-1.5 rounded-lg hover:bg-slate-800 hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-medium"
            title="自适应居中"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">复位</span>
          </button>
        </div>
      </div>

      {/* SVG 拓扑有向图主体层 (Curves & foreignObject Nodes) */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          width: layout.width,
          height: layout.height,
        }}
        className="relative transition-transform duration-75"
      >
        <svg
          width={layout.width}
          height={layout.height}
          className="absolute inset-0 pointer-events-none overflow-visible"
        >
          <defs>
            {/* 连线箭头指示标记 */}
            <marker
              id="arrow-default"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#6366f1" />
            </marker>
            <marker
              id="arrow-bad-end"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#f43f5e" />
            </marker>
            <marker
              id="arrow-true-end"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#f59e0b" />
            </marker>
          </defs>

          {/* 渲染所有分支贝塞尔曲线 (Bézier Curves) */}
          {choices.map((choice) => {
            const from = layout.nodeMap.get(choice.fromNodeId);
            const to = layout.nodeMap.get(choice.toNodeId);
            if (!from || !to) return null;

            // 连线起点：源节点右侧中央 (x + cardWidth, y + cardHeight / 2)
            const cardWidth = 240;
            const cardHeight = 110;
            const x1 = from.x + cardWidth;
            const y1 = from.y + cardHeight / 2;
            const x2 = to.x;
            const y2 = to.y + cardHeight / 2;

            const dx = Math.max(80, (x2 - x1) * 0.45);
            const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

            const isBadEndChoice = to.node.type === 'bad_end' || choice.id.includes('bad');
            const isTrueEndChoice = to.node.type === 'true_end' || choice.id.includes('true');

            const strokeColor = isBadEndChoice
              ? '#f43f5e'
              : isTrueEndChoice
              ? '#f59e0b'
              : '#6366f1';

            const markerId = isBadEndChoice
              ? 'url(#arrow-bad-end)'
              : isTrueEndChoice
              ? 'url(#arrow-true-end)'
              : 'url(#arrow-default)';

            return (
              <g key={choice.id} className="cursor-pointer group pointer-events-auto">
                {/* 粗发光背景线 */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isBadEndChoice ? 3 : 2}
                  strokeOpacity={0.6}
                  strokeDasharray={isBadEndChoice ? '4,4' : undefined}
                  className="transition-all group-hover:stroke-opacity-100 group-hover:stroke-width-3"
                />
                {/* 连线端点箭头 */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={2}
                  markerEnd={markerId}
                />
              </g>
            );
          })}
        </svg>

        {/* 分支选项标签悬浮层 (Choice Label Pills, 位于连接线中央且层级在卡片之上) */}
        {choices.map((choice) => {
          const from = layout.nodeMap.get(choice.fromNodeId);
          const to = layout.nodeMap.get(choice.toNodeId);
          if (!from || !to || !choice.choiceText) return null;

          const cardWidth = 240;
          const cardHeight = 110;
          const x1 = from.x + cardWidth;
          const y1 = from.y + cardHeight / 2;
          const x2 = to.x;
          const y2 = to.y + cardHeight / 2;

          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          const isBadEndChoice = to.node.type === 'bad_end' || choice.id.includes('bad');
          const isTrueEndChoice = to.node.type === 'true_end' || choice.id.includes('true');

          return (
            <div
              key={choice.id}
              style={{
                left: `${midX}px`,
                top: `${midY}px`,
                transform: 'translate(-50%, -50%)',
              }}
              className="absolute z-20 group cursor-pointer pointer-events-auto"
              title={choice.choiceText}
            >
              <div
                className={`px-3 py-1 rounded-full text-[10px] font-bold text-center border shadow-xl backdrop-blur-md transition-all group-hover:scale-105 max-w-[210px] truncate ${
                  isBadEndChoice
                    ? 'bg-rose-950/95 text-rose-200 border-rose-500/70 ring-1 ring-rose-500/30'
                    : isTrueEndChoice
                    ? 'bg-amber-950/95 text-amber-200 border-amber-500/70 ring-1 ring-amber-500/30'
                    : 'bg-slate-900/95 text-indigo-200 border-indigo-500/60 ring-1 ring-indigo-500/30'
                }`}
              >
                {choice.choiceText}
              </div>
            </div>
          );
        })}

        {/* 节点卡片列表 */}
        {layout.layoutNodes.map((item) => {
          const { node, x, y } = item;
          const isSelected = selectedNodeId === node.id;
          const isBadEnd = node.type === 'bad_end';
          const cfg = getNodeVisualConfig(node.type, isBadEnd);
          const IconComp = cfg.icon;

          return (
            <div
              key={node.id}
              style={{ left: `${x}px`, top: `${y}px`, width: '240px' }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedNodeId(node.id);
                onSelectNode?.(node);
              }}
              className={`topology-node-card absolute rounded-2xl p-3.5 border text-left shadow-lg backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                cfg.cardBorder
              } ${isSelected ? 'ring-2 ring-indigo-400 scale-105 z-30 shadow-indigo-500/40' : 'z-10 hover:scale-102'} ${
                cfg.glow
              }`}
            >
              <div>
                {/* 顶部标题与类型徽章 */}
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className="font-mono text-[10px] font-bold text-slate-400">
                    {node.id}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[9px] font-bold border flex items-center gap-1 ${cfg.badgeBg}`}
                  >
                    <IconComp className="w-2.5 h-2.5 shrink-0" />
                    <span>{cfg.label}</span>
                  </span>
                </div>

                <h4 className={`text-xs font-bold tracking-tight line-clamp-1 ${cfg.headerText}`}>
                  {node.title}
                </h4>

                <p className="text-[10px] text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                  {node.summary}
                </p>
              </div>

              {/* 微交互脚标 */}
              <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-[9px] text-slate-400">
                <div className="flex items-center gap-1">
                  {node.hotspots && node.hotspots.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-cyan-900/60 text-cyan-300 font-mono">
                      搜证×{node.hotspots.length}
                    </span>
                  )}
                  {node.commMessage && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-mono">
                      即时通讯
                    </span>
                  )}
                  {node.evidencePresent && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-300 font-mono">
                      证物对质
                    </span>
                  )}
                </div>
                {node.estimatedDurationSec && (
                  <span className="font-mono text-slate-500 flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {node.estimatedDurationSec}s
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 侧边节点详情查看抽屉 (Node Inspector Drawer) */}
      {selectedNode && (
        <div className="absolute right-4 top-16 bottom-4 w-84 bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-xl p-5 z-40 overflow-y-auto space-y-4 text-slate-200">
          <div className="flex items-start justify-between border-b border-slate-700 pb-3">
            <div>
              <span className="text-[10px] font-mono text-indigo-400 font-bold block">
                {selectedNode.id} · {selectedNode.type}
              </span>
              <h3 className="text-sm font-bold text-white mt-0.5">{selectedNode.title}</h3>
            </div>
            <button
              onClick={() => setSelectedNodeId(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              剧情事件总述
            </span>
            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3 rounded-xl border border-slate-800">
              {selectedNode.summary}
            </p>
          </div>

          {/* 挂载的微交互详情 */}
          {selectedNode.hotspots && selectedNode.hotspots.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider block flex items-center gap-1">
                <Search className="w-3 h-3" />
                点触搜查点 ({selectedNode.hotspots.length}处)
              </span>
              <div className="space-y-1">
                {selectedNode.hotspots.map((spot: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-cyan-950/40 border border-cyan-800/50 text-[11px] text-cyan-200"
                  >
                    <div className="font-bold">{spot.label || spot.id}</div>
                    <p className="text-[10px] text-slate-400 mt-0.5">{spot.feedback || spot.action}</p>
                    {spot.itemReward && (
                      <span className="text-[9px] text-amber-300 bg-amber-950 px-1.5 py-0.5 rounded mt-1 inline-block">
                        🎁 获得物证: {spot.itemReward}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedNode.commMessage && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                即时通讯轮盘
              </span>
              <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/50 text-[11px] space-y-1.5">
                <div className="text-indigo-200 font-bold">{selectedNode.commMessage.sender}:</div>
                <p className="text-slate-300 italic text-[10px]">"{selectedNode.commMessage.content}"</p>
              </div>
            </div>
          )}

          {selectedNode.evidencePresent && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block flex items-center gap-1">
                <Briefcase className="w-3 h-3" />
                出示证物对质判定
              </span>
              <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/50 text-[11px] text-rose-200">
                <span className="font-bold">需出示: {selectedNode.evidencePresent.requiredItem}</span>
              </div>
            </div>
          )}

          {/* 出边分支选项 */}
          <div className="space-y-1.5 pt-2 border-t border-slate-800">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              后续分支抉择
            </span>
            <div className="space-y-1">
              {choices
                .filter((c) => c.fromNodeId === selectedNode.id)
                .map((c, i) => (
                  <div
                    key={i}
                    onClick={() => setSelectedNodeId(c.toNodeId)}
                    className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-xs flex items-center justify-between cursor-pointer transition-colors"
                  >
                    <span className="text-slate-200 text-[11px]">{c.choiceText}</span>
                    <div className="flex items-center gap-1 text-indigo-400 text-[10px] font-mono">
                      <span>{c.toNodeId}</span>
                      <ArrowRight className="w-3 h-3" />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
