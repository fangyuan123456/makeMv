/**
 * client/src/components/studio/stages/planner/PlannerTopologyDiagram.tsx
 * 工序 1：竖向故事流向拓扑图组件 (Top-Down Pure Native SVG - 优雅现代亮色系 Light Theme)
 *
 * 核心机制：
 * 1. 100% 消费 UniversalPrdSpec (clips + interactions + endings + wiring)；
 * 2. 纯代码确定性分层排版算法 (自上而下分层流向 + 多路并行展开 + 回溯轨道)；
 * 3. 亮色系统一视觉：
 *    - 画布背景：优雅柔和的工程浅灰底 (#f8fafc) + 细腻点阵网格；
 *    - 节点卡片：清爽高对比度配色 (起始青蓝 / 片段纯白 / 抉择暖金 / HE翡翠绿 / BE玫瑰红)；
 *    - 文字排版：纯深色抗疲劳高信噪比排版；
 * 4. 交互：支持拖拽平移、鼠标滚轮缩放、悬浮连线高亮、点击节点选中回调。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  UniversalPrdSpec,
  PrdInteractionNode,
  PrdEndingNode,
} from '../../../../types/index.js';
import {
  TopoNodeShape,
  TopoLegendIcon,
  type TopoShapeKind,
} from './TopoNodeShape.js';

export type TopoNodeKind = 'clip' | 'interaction' | 'ending';

export interface PlannerTopoNode {
  id: string;
  kind: TopoNodeKind;
  shape: TopoShapeKind;
  title: string;
  subtitle: string;
  shortTag?: string;
  badge: string;
  badgeColor: string;
  accentColor: string;
  bgColor: string;
  textColor: string;
  subTextColor: string;
  isStart?: boolean;
  isVictory?: boolean;
  hasStateChange?: boolean;
  timeoutSec?: number | null;
}

export type TopoEdgeKind = 'normal' | 'choice' | 'conditional' | 'timeout' | 'rewind';

export interface PlannerTopoEdge {
  id: string;
  from: string;
  to: string;
  kind: TopoEdgeKind;
  shortLabel: string;
  fullLabel: string;
  condition?: string | null;
  transitionText?: string | null;
}

export interface TopoNodeFocusRequest {
  nodeId: string;
  seq: number;
}

interface PlannerTopologyDiagramProps {
  prd: UniversalPrdSpec;
  storySections?: Record<string, { title: string; narrativeText: string }>;
  selectedNodeId?: string | null;
  focusNodeRequest?: TopoNodeFocusRequest | null;
  onSelectNode?: (nodeId: string) => void;
  onClearSelection?: () => void;
}

interface PositionedNode {
  node: PlannerTopoNode;
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
}

interface PositionedEdge {
  edge: PlannerTopoEdge;
  path: string;
  lx: number;
  ly: number;
}

function truncateText(text: string, maxChars: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1))}…`;
}

function summarizeStateChange(inter: PrdInteractionNode): boolean {
  return (inter.outcomes || []).some(
    (o) =>
      o.stateChange &&
      ((o.stateChange.add && Object.keys(o.stateChange.add).length > 0) ||
        (o.stateChange.set && Object.keys(o.stateChange.set).length > 0))
  );
}

function formatInteractionKindLabel(kind: string): string {
  const upper = (kind || 'INTERACT').toUpperCase();
  const map: Record<string, string> = {
    CHOICE: '分支抉择',
    TIMED_CHOICE: '限时抉择',
    SEARCH: '搜证寻物',
    HOLD: '长按互动',
    QTE_TAP: '连点破局',
    TIMING: '时机靶区',
    CLICK: '关键触发',
    ACTION_ZONE: '方位热区',
    TAP_HOTSPOT: '热点点击',
    WIPE: '擦拭探索',
    INPUT: '文本输入',
    QTE: '限时QTE',
  };
  return map[upper] || upper;
}

export const PlannerTopologyDiagram: React.FC<PlannerTopologyDiagramProps> = ({
  prd,
  storySections = {},
  selectedNodeId,
  focusNodeRequest,
  onSelectNode,
  onClearSelection,
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [pulsingNodeId, setPulsingNodeId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, SVGGElement | null>>(new Map());
  const dragStateRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });

  // 点击外部触发聚焦与脉冲高亮
  useEffect(() => {
    const targetId = focusNodeRequest?.nodeId;
    if (!targetId) return;
    const el = nodeRefs.current.get(targetId);
    if (!el) return;

    setPulsingNodeId(null);
    let raf2 = 0;
    let timer: number | undefined;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        setPulsingNodeId(targetId);
        timer = window.setTimeout(() => {
          setPulsingNodeId((prev) => (prev === targetId ? null : prev));
        }, 1450);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [focusNodeRequest]);

  // 1. 组装三类节点与全部有向边 (亮色系现代调色盘)
  const { nodes, edges, forwardEdges } = useMemo(() => {
    const nodeList: PlannerTopoNode[] = [];
    const nodeMap = new Map<string, PlannerTopoNode>();
    const interMap = new Map<string, PrdInteractionNode>(
      (prd.interactions || []).map((i) => [i.id, i])
    );
    const endingMap = new Map<string, PrdEndingNode>(
      (prd.endings || []).map((e) => [e.id, e])
    );

    const clips = prd.clips || [];
    const startId = prd.startNodeId || clips[0]?.id || 'c1';

    // 1.1 片段节点 (Clips)
    for (const clip of clips) {
      const isStart = clip.id === startId;
      const sec = storySections[clip.id];
      const sub = sec?.narrativeText
        ? truncateText(sec.narrativeText, 32)
        : clip.narrativeText
        ? truncateText(clip.narrativeText, 32)
        : `视频片段 · ${clip.video || `${clip.id}.mp4`}`;

      const node: PlannerTopoNode = {
        id: clip.id,
        kind: 'clip',
        shape: isStart ? 'stadium' : 'rect',
        title: clip.title || clip.id,
        subtitle: sub,
        shortTag: isStart ? '起点' : undefined,
        badge: isStart ? '起点' : '片段',
        badgeColor: isStart ? '#0891b2' : '#6366f1',
        accentColor: isStart ? '#0891b2' : '#cbd5e1',
        bgColor: isStart ? '#e0f2fe' : '#ffffff',
        textColor: '#0f172a',
        subTextColor: isStart ? '#0369a1' : '#64748b',
        isStart,
      };
      nodeList.push(node);
      nodeMap.set(clip.id, node);
    }

    // 1.2 互动节点 (Interactions)
    for (const inter of prd.interactions || []) {
      const hasSc = summarizeStateChange(inter);
      const kindLabel = formatInteractionKindLabel(inter.kind);
      const sub = truncateText(inter.prompt || '', 32);

      const node: PlannerTopoNode = {
        id: inter.id,
        kind: 'interaction',
        shape: 'hexagon',
        title: inter.prompt || inter.id,
        subtitle: sub,
        shortTag: kindLabel,
        badge: kindLabel,
        badgeColor: '#d97706',
        accentColor: '#f59e0b',
        bgColor: '#fffbeb',
        textColor: '#78350f',
        subTextColor: '#b45309',
        hasStateChange: hasSc,
        timeoutSec: inter.timeoutSec,
      };
      nodeList.push(node);
      nodeMap.set(inter.id, node);
    }

    // 1.3 结局节点 (Endings)
    for (const ending of prd.endings || []) {
      const isVictory = Boolean(ending.isVictory);
      const sub = truncateText(ending.summary || '', 32);

      const node: PlannerTopoNode = {
        id: ending.id,
        kind: 'ending',
        shape: 'octagon',
        title: ending.title || ending.id,
        subtitle: sub,
        shortTag: ending.endingType,
        badge: ending.endingType || (isVictory ? 'HE' : 'BE'),
        badgeColor: isVictory ? '#059669' : '#dc2626',
        accentColor: isVictory ? '#059669' : '#e11d48',
        bgColor: isVictory ? '#ecfdf5' : '#fff1f2',
        textColor: isVictory ? '#064e3b' : '#881337',
        subTextColor: isVictory ? '#047857' : '#be123c',
        isVictory,
      };
      nodeList.push(node);
      nodeMap.set(ending.id, node);
    }

    // 1.4 全剧接线边 (Wiring Edges)
    const edgeList: PlannerTopoEdge[] = [];
    const forwardEdgeList: PlannerTopoEdge[] = [];

    (prd.wiring || []).forEach((w, idx) => {
      if (!nodeMap.has(w.from) || !nodeMap.has(w.to)) return;

      const fromInter = interMap.get(w.from);
      let shortLabel = '';
      let fullLabel = '';
      let kind: TopoEdgeKind = 'normal';

      if (fromInter) {
        kind = 'choice';
        const oc = (fromInter.outcomes || []).find((o) => o.key === w.onOutcome);
        shortLabel = oc ? `${oc.key}·${truncateText(oc.label, 4)}` : w.onOutcome;
        fullLabel = oc ? `[${oc.key}] ${oc.label}` : w.onOutcome;
      } else if (w.onOutcome === 'onEnded') {
        shortLabel = '';
        fullLabel = '顺向衔接';
      } else {
        shortLabel = w.onOutcome;
        fullLabel = w.onOutcome;
      }

      if (w.condition) {
        kind = 'conditional';
        fullLabel += ` (${w.condition})`;
      }

      const edge: PlannerTopoEdge = {
        id: `w_${idx}_${w.from}_${w.to}`,
        from: w.from,
        to: w.to,
        kind,
        shortLabel,
        fullLabel,
        condition: w.condition,
        transitionText: w.transition?.text,
      };

      edgeList.push(edge);
      forwardEdgeList.push(edge);
    });

    // 1.5 结局回溯轨道边 (Rewind Edges)
    (prd.endings || []).forEach((ending, idx) => {
      if (ending.rewindTargetClipId && nodeMap.has(ending.rewindTargetClipId)) {
        const edge: PlannerTopoEdge = {
          id: `rewind_${idx}_${ending.id}_${ending.rewindTargetClipId}`,
          from: ending.id,
          to: ending.rewindTargetClipId,
          kind: 'rewind',
          shortLabel: '回溯重选',
          fullLabel: `回溯至 ${ending.rewindTargetClipId}`,
        };
        edgeList.push(edge);
      }
    });

    return { nodes: nodeList, edges: edgeList, forwardEdges: forwardEdgeList };
  }, [prd, storySections]);

  // 2. 自上而下分层图论拓扑布局算法
  const layout = useMemo(() => {
    if (nodes.length === 0) {
      return { positionedNodes: [], positionedEdges: [], svgW: 800, svgH: 600, maxRow: 0 };
    }

    const NODE_W = 190;
    const NODE_H = 58;
    const GAP_X = 54;
    const GAP_Y = 64;

    const startId = prd.startNodeId || prd.clips?.[0]?.id || 'c1';

    // 邻接表
    const childrenMap = new Map<string, string[]>();
    for (const e of forwardEdges) {
      if (!childrenMap.has(e.from)) childrenMap.set(e.from, []);
      childrenMap.get(e.from)!.push(e.to);
    }

    // BFS 计算每个节点的深度 row
    const rowMap = new Map<string, number>();
    const queue: Array<{ id: string; row: number }> = [{ id: startId, row: 0 }];
    rowMap.set(startId, 0);

    const visited = new Set<string>([startId]);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const nextList = childrenMap.get(cur.id) || [];
      for (const nxt of nextList) {
        const nextRow = cur.row + 1;
        const existRow = rowMap.get(nxt);
        if (existRow === undefined || nextRow > existRow) {
          rowMap.set(nxt, nextRow);
        }
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push({ id: nxt, row: nextRow });
        }
      }
    }

    // 兜底未触达节点
    let maxKnownRow = 0;
    for (const r of rowMap.values()) {
      if (r > maxKnownRow) maxKnownRow = r;
    }
    for (const n of nodes) {
      if (!rowMap.has(n.id)) {
        maxKnownRow += 1;
        rowMap.set(n.id, maxKnownRow);
      }
    }

    // 按 row 分桶
    const buckets = new Map<number, PlannerTopoNode[]>();
    for (const n of nodes) {
      const r = rowMap.get(n.id) || 0;
      if (!buckets.has(r)) buckets.set(r, []);
      buckets.get(r)!.push(n);
    }

    const sortedRows = Array.from(buckets.keys()).sort((a, b) => a - b);
    let maxCols = 1;
    for (const r of sortedRows) {
      const count = buckets.get(r)!.length;
      if (count > maxCols) maxCols = count;
    }

    const canvasW = Math.max(900, maxCols * (NODE_W + GAP_X) + 160);
    const centerX = canvasW / 2;

    const posMap = new Map<string, PositionedNode>();
    const positionedNodes: PositionedNode[] = [];

    let curY = 48;
    for (const r of sortedRows) {
      const rowNodes = buckets.get(r)!;
      const count = rowNodes.length;
      const totalRowW = count * NODE_W + (count - 1) * GAP_X;
      const startX = centerX - totalRowW / 2;

      rowNodes.forEach((n, colIdx) => {
        const x = startX + colIdx * (NODE_W + GAP_X);
        const y = curY;
        const pos: PositionedNode = {
          node: n,
          x,
          y,
          w: NODE_W,
          h: NODE_H,
          row: r,
          col: colIdx,
        };
        posMap.set(n.id, pos);
        positionedNodes.push(pos);
      });

      curY += NODE_H + GAP_Y;
    }

    const svgH = curY + 60;
    const svgW = canvasW;

    // 绘制有向边
    const positionedEdges: PositionedEdge[] = [];
    for (const e of edges) {
      const fromPos = posMap.get(e.from);
      const toPos = posMap.get(e.to);
      if (!fromPos || !toPos) continue;

      let pathStr = '';
      let lx = 0;
      let ly = 0;

      if (e.kind === 'rewind') {
        // 右侧回溯轨道弧线
        const fx = fromPos.x + fromPos.w;
        const fy = fromPos.y + fromPos.h / 2;
        const tx = toPos.x + toPos.w;
        const ty = toPos.y + toPos.h / 2;
        const trackX = Math.max(fx, tx) + 60;

        pathStr = `M ${fx} ${fy} C ${trackX} ${fy}, ${trackX} ${ty}, ${tx} ${ty}`;
        lx = trackX - 10;
        ly = (fy + ty) / 2;
      } else {
        // 自上而下顺向/分支平滑贝塞尔曲线
        const fx = fromPos.x + fromPos.w / 2;
        const fy = fromPos.y + fromPos.h;
        const tx = toPos.x + toPos.w / 2;
        const ty = toPos.y;

        const deltaY = ty - fy;
        const c1y = fy + deltaY * 0.45;
        const c2y = ty - deltaY * 0.45;

        pathStr = `M ${fx} ${fy} C ${fx} ${c1y}, ${tx} ${c2y}, ${tx} ${ty}`;
        lx = (fx + tx) / 2;
        ly = (fy + ty) / 2;
      }

      positionedEdges.push({
        edge: e,
        path: pathStr,
        lx,
        ly,
      });
    }

    return { positionedNodes, positionedEdges, svgW, svgH, maxRow: sortedRows.length };
  }, [nodes, edges, forwardEdges, prd.startNodeId, prd.clips]);

  // 高亮逻辑
  const focusNodeId = hoveredNodeId || selectedNodeId;
  const relatedNodeIds = useMemo(() => {
    if (!focusNodeId) return new Set<string>();
    const set = new Set<string>([focusNodeId]);
    for (const e of edges) {
      if (e.from === focusNodeId) set.add(e.to);
      if (e.to === focusNodeId) set.add(e.from);
    }
    return set;
  }, [focusNodeId, edges]);

  // 鼠标拖拽平移支持
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return;
    dragStateRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: scrollRef.current.scrollLeft,
      scrollTop: scrollRef.current.scrollTop,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.active || !scrollRef.current) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragStateRef.current.moved = true;
    }
    scrollRef.current.scrollLeft = dragStateRef.current.scrollLeft - dx;
    scrollRef.current.scrollTop = dragStateRef.current.scrollTop - dy;
  };

  const handleMouseUp = () => {
    dragStateRef.current.active = false;
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-slate-50/70 rounded-2xl border border-slate-200/90 overflow-hidden select-none">
      {/* 顶栏图例指示 (亮色现代半透明) */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/95 border-b border-slate-200/90 text-[11px] text-slate-700 z-10 flex-shrink-0 backdrop-blur-sm shadow-2xs">
        <div className="flex items-center space-x-3.5">
          <span className="font-bold text-slate-800 flex items-center gap-1.5">
            <span>🗺️</span>
            <span>故事流向拓扑图</span>
          </span>
          <span className="text-slate-300">|</span>
          <div className="flex items-center space-x-1.5">
            <TopoLegendIcon shape="stadium" stroke="#0891b2" fill="#e0f2fe" />
            <span className="text-slate-700 font-medium">起始幕</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <TopoLegendIcon shape="rect" stroke="#94a3b8" fill="#ffffff" />
            <span className="text-slate-700 font-medium">剧情片段</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <TopoLegendIcon shape="hexagon" stroke="#f59e0b" fill="#fef3c7" />
            <span className="text-amber-800 font-medium">分支抉择</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <TopoLegendIcon shape="octagon" stroke="#059669" fill="#d1fae5" />
            <span className="text-emerald-800 font-medium">通关结局</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <TopoLegendIcon shape="octagon" stroke="#e11d48" fill="#ffe4e6" />
            <span className="text-rose-800 font-medium">终局</span>
          </div>
        </div>

        <div className="flex items-center space-x-3 text-slate-500 font-mono text-[10px]">
          <span>按住鼠标左键可自由拖拽平移</span>
          {selectedNodeId && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-indigo-600 hover:text-indigo-800 underline font-semibold"
            >
              清除选中
            </button>
          )}
        </div>
      </div>

      {/* SVG 拓扑画布容器 (亮色优雅底色) */}
      <div
        ref={scrollRef}
        className="flex-1 w-full h-full overflow-auto cursor-grab active:cursor-grabbing relative"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          width={layout.svgW}
          height={layout.svgH}
          className="min-w-full min-h-full block"
          style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}
        >
          <defs>
            {/* 顺向箭头 */}
            <marker
              id="topo-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#94a3b8" />
            </marker>
            {/* 分支抉择箭头 */}
            <marker
              id="topo-arrow-choice"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#f59e0b" />
            </marker>
            {/* 回溯重选箭头 */}
            <marker
              id="topo-arrow-rewind"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#6366f1" />
            </marker>
            {/* 选中发光滤镜 (柔和现代靛蓝阴影) */}
            <filter id="planner-node-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#4f46e5" floodOpacity="0.35" />
            </filter>
          </defs>

          {/* 背景浅色点阵装饰网格 */}
          <pattern id="dot-grid-light" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.1" fill="rgba(148, 163, 184, 0.28)" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#dot-grid-light)" pointerEvents="none" />

          {/* 边层 (Edges) */}
          {layout.positionedEdges.map(({ edge, path, lx, ly }) => {
            const isRewind = edge.kind === 'rewind';
            const isChoice = edge.kind === 'choice';
            const isHighlighted =
              focusNodeId && (edge.from === focusNodeId || edge.to === focusNodeId);
            const isDimmed = focusNodeId && !isHighlighted;

            const strokeColor = isRewind
              ? '#6366f1'
              : isChoice
              ? '#f59e0b'
              : isHighlighted
              ? '#4f46e5'
              : '#94a3b8';

            const markerEnd = isRewind
              ? 'url(#topo-arrow-rewind)'
              : isChoice
              ? 'url(#topo-arrow-choice)'
              : 'url(#topo-arrow)';

            const pillW = Math.max(38, (edge.shortLabel || '').length * 10 + 16);

            return (
              <g key={edge.id} opacity={isDimmed ? 0.22 : 1} style={{ transition: 'opacity 0.2s' }}>
                <path
                  d={path}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isHighlighted ? 2.5 : isRewind ? 1.6 : 1.4}
                  strokeDasharray={isRewind ? '5 3' : undefined}
                  markerEnd={markerEnd}
                />
                {edge.shortLabel && (
                  <g transform={`translate(${lx.toFixed(1)}, ${ly.toFixed(1)})`}>
                    <rect
                      x={-pillW / 2}
                      y={-9}
                      width={pillW}
                      height={18}
                      rx={9}
                      fill="#ffffff"
                      stroke={strokeColor}
                      strokeWidth={1}
                      filter="drop-shadow(0 1px 1px rgba(0,0,0,0.06))"
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fill="#334155"
                      fontSize="9"
                      fontWeight={600}
                      fontFamily="sans-serif"
                    >
                      {edge.shortLabel}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* 节点层 (Nodes) */}
          {layout.positionedNodes.map(({ node, x, y, w, h }) => {
            const isSelected = selectedNodeId === node.id;
            const isHovered = hoveredNodeId === node.id;
            const isPulsing = pulsingNodeId === node.id;
            const isRelated = focusNodeId ? relatedNodeIds.has(node.id) : true;
            const strokeColor = isSelected ? '#4f46e5' : isHovered ? '#6366f1' : node.accentColor;

            return (
              <g
                key={node.id}
                ref={(el) => {
                  if (el) nodeRefs.current.set(node.id, el);
                  else nodeRefs.current.delete(node.id);
                }}
                data-node-id={node.id}
                transform={`translate(${x}, ${y})`}
                opacity={focusNodeId && !isRelated ? 0.35 : 1}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (dragStateRef.current.moved) return;
                  onSelectNode?.(node.id);
                }}
              >
                <title>{`[${node.id}] ${node.title} (${node.badge})\n${node.subtitle}`}</title>

                {/* 脉冲光圈 */}
                {isPulsing && (
                  <g transform="translate(-6, -6)" pointerEvents="none">
                    <TopoNodeShape
                      shape={node.shape}
                      w={w + 12}
                      h={h + 12}
                      fill="none"
                      stroke="#4f46e5"
                      strokeWidth={2.5}
                    />
                  </g>
                )}

                <TopoNodeShape
                  shape={node.shape}
                  w={w}
                  h={h}
                  fill={node.bgColor}
                  stroke={strokeColor}
                  strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.4}
                  strokeDasharray={node.kind === 'interaction' && !isSelected ? '4 2' : undefined}
                  doubleBorder={node.kind === 'ending'}
                  filter={isSelected ? 'url(#planner-node-glow)' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.05))'}
                />

                {/* 节点编号与标签 */}
                <text
                  x={w / 2}
                  y={19}
                  fill={isSelected ? '#4f46e5' : node.subTextColor}
                  fontSize="10"
                  fontWeight={700}
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {node.shortTag
                    ? `${truncateText(node.id, 10)} · ${node.shortTag}`
                    : truncateText(node.id, 14)}
                </text>

                {/* 节点标题 (亮色深色字体，高可读性) */}
                <text
                  x={w / 2}
                  y={38}
                  fill={node.textColor}
                  fontSize="12"
                  fontWeight={700}
                  fontFamily="sans-serif"
                  textAnchor="middle"
                >
                  {truncateText(node.title, 10)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
