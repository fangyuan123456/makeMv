/**
 * client/src/components/FilmTopologyDiagram.tsx
 * 视频工坊：纯视听镜头流向拓扑图 (Pure Cinematic Top-Down SVG)
 *
 * 核心设计：
 * 1. 彻底去除互动点卡片（不要 interaction 节点），仅保留镜头片段 (clip) 与结局终局 (ending)；
 * 2. 跨 interaction 穿透：将 clip -> interaction -> clip/ending 穿透缝合为纯视听镜头跳转弧线，保留分支剧情语义；
 * 3. 黄金居中骨干算法：主线镜头垂直严格居中在 50% 轴线，左右剧情分支交替平衡分布，对称优雅；
 * 4. 完整的平移缩放、节点选择、镜头详情抽屉联动。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  UniversalPrdSpec,
  StorySectionItem,
  PrdEndingNode,
} from '../types/index.js';
import {
  TopoNodeShape,
  getShapeAnchors,
  type TopoShapeKind,
} from './TopoNodeShape.js';

export type FilmTopoNodeKind = 'clip' | 'ending';

export interface FilmTopoNode {
  id: string;
  kind: FilmTopoNodeKind;
  shape: TopoShapeKind;
  title: string;
  subtitle: string;
  shortTag?: string;
  badge: string;
  badgeColor: string;
  accentColor: string;
  bgColor: string;
  isStart?: boolean;
  isVictory?: boolean;
  endingType?: string;
}

export interface FilmTopoEdge {
  id: string;
  from: string;
  to: string;
  shortLabel: string;
  fullLabel: string;
  isBranch?: boolean;
  isRewind?: boolean;
}

interface PositionedFilmNode {
  node: FilmTopoNode;
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
}

interface PositionedFilmEdge {
  edge: FilmTopoEdge;
  path: string;
  lx: number;
  ly: number;
}

interface FilmTopologyDiagramProps {
  prd: UniversalPrdSpec;
  storySections?: Record<string, StorySectionItem>;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  onClearSelection?: () => void;
  className?: string;
}

function truncateText(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1))}…`;
}

export const FilmTopologyDiagram: React.FC<FilmTopologyDiagramProps> = ({
  prd,
  storySections,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
  className = '',
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
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

  // 1. 穿透 Interaction 构建纯视听节点与直连边
  const { nodes, edges } = useMemo(() => {
    const nodeList: FilmTopoNode[] = [];
    const nodeMap = new Map<string, FilmTopoNode>();
    const endingMap = new Map<string, PrdEndingNode>(prd.endings.map((e) => [e.id, e]));

    // 1.1 镜头片段节点
    for (const clip of prd.clips) {
      const isStart = clip.id === prd.startNodeId;
      const sec = storySections?.[clip.id];
      const storySnippet = sec?.narrativeText
        ? truncateText(sec.narrativeText, 24)
        : `镜头切片 ${clip.video || clip.id}`;

      const node: FilmTopoNode = {
        id: clip.id,
        kind: 'clip',
        shape: 'rect',
        title: clip.title || sec?.title || clip.id,
        subtitle: storySnippet,
        shortTag: isStart ? '🎬 起始镜头' : '镜头切片',
        badge: isStart ? '起幅' : '切片',
        badgeColor: '#0284c7',
        accentColor: '#0284c7',
        bgColor: '#f0f9ff',
        isStart,
      };
      nodeList.push(node);
      nodeMap.set(node.id, node);
    }

    // 1.2 结局终局节点
    const endingColorMap: Record<string, { badge: string; accent: string; bg: string }> = {
      TE: { badge: '#059669', accent: '#059669', bg: '#ecfdf5' },
      HE: { badge: '#0d9488', accent: '#0d9488', bg: '#f0fdfa' },
      BE: { badge: '#e11d48', accent: '#e11d48', bg: '#fff1f2' },
      NE: { badge: '#4b5563', accent: '#4b5563', bg: '#f3f4f6' },
      SE: { badge: '#7c3aed', accent: '#7c3aed', bg: '#faf5ff' },
    };

    for (const ending of prd.endings) {
      const colors = endingColorMap[ending.endingType] || endingColorMap.NE;
      const node: FilmTopoNode = {
        id: ending.id,
        kind: 'ending',
        shape: 'stadium',
        title: `[${ending.endingType}] ${ending.title}`,
        subtitle: truncateText(ending.summary || '故事走向终局', 24),
        shortTag: ending.isVictory ? '胜利终局' : '终局',
        badge: `${ending.endingType} 结局`,
        badgeColor: colors.badge,
        accentColor: colors.accent,
        bgColor: colors.bg,
        isVictory: ending.isVictory,
        endingType: ending.endingType,
      };
      nodeList.push(node);
      nodeMap.set(node.id, node);
    }

    // 1.3 穿透 interaction 缝合连线：
    // 找出所有 clip -> interaction 和 interaction -> (clip | ending)
    const clipToInterMap = new Map<string, Array<{ interId: string; label: string }>>();
    const interToTargetMap = new Map<string, Array<{ targetId: string; label: string; transition?: string | null }>>();
    const directEdges: FilmTopoEdge[] = [];

    // 构建 interaction outcome label 映射表
    const interOutcomeLabels = new Map<string, Map<string, string>>();
    for (const inter of prd.interactions) {
      const outcomeMap = new Map<string, string>();
      for (const o of inter.outcomes || []) {
        outcomeMap.set(o.key, o.label);
      }
      interOutcomeLabels.set(inter.id, outcomeMap);
    }

    const interactionIds = new Set(prd.interactions.map((i) => i.id));

    for (const w of prd.wiring) {
      const isFromClip = nodeMap.has(w.from) && nodeMap.get(w.from)?.kind === 'clip';
      const isToInter = interactionIds.has(w.to);
      const isFromInter = interactionIds.has(w.from);
      const isToTarget = nodeMap.has(w.to);

      if (isFromClip && isToInter) {
        const list = clipToInterMap.get(w.from) || [];
        list.push({ interId: w.to, label: w.onOutcome || '' });
        clipToInterMap.set(w.from, list);
      } else if (isFromInter && isToTarget) {
        const list = interToTargetMap.get(w.from) || [];
        const outcomeMap = interOutcomeLabels.get(w.from);
        const resolvedLabel = outcomeMap?.get(w.onOutcome) || w.onOutcome || '';
        list.push({ targetId: w.to, label: resolvedLabel, transition: w.transition?.text });
        interToTargetMap.set(w.from, list);
      } else if (isFromClip && isToTarget) {
        // 直连边
        directEdges.push({
          id: `${w.from}->${w.to}:${w.onOutcome}`,
          from: w.from,
          to: w.to,
          shortLabel: truncateText(w.onOutcome || '顺向运镜', 8),
          fullLabel: w.onOutcome || '顺向镜头转场',
        });
      }
    }

    // 穿透组装：clip -> interaction -> target
    const synthesizedEdges: FilmTopoEdge[] = [...directEdges];
    const edgeKeySet = new Set<string>();

    for (const [fromClipId, interRefs] of clipToInterMap.entries()) {
      for (const interRef of interRefs) {
        const targets = interToTargetMap.get(interRef.interId) || [];
        for (const target of targets) {
          const edgeId = `${fromClipId}->${target.targetId}`;
          if (edgeKeySet.has(edgeId)) continue;
          edgeKeySet.add(edgeId);

          const label = target.label || interRef.label || '剧情演进';
          synthesizedEdges.push({
            id: edgeId,
            from: fromClipId,
            to: target.targetId,
            shortLabel: truncateText(label, 9),
            fullLabel: label,
            isBranch: targets.length > 1,
          });
        }
      }
    }

    // 1.4 处理结局回溯边 (rewind)
    for (const ending of prd.endings) {
      if (ending.rewindTargetClipId && nodeMap.has(ending.rewindTargetClipId)) {
        synthesizedEdges.push({
          id: `${ending.id}->${ending.rewindTargetClipId}:rewind`,
          from: ending.id,
          to: ending.rewindTargetClipId,
          shortLabel: '↩ 回溯重选',
          fullLabel: `回溯至 ${ending.rewindTargetClipId}`,
          isRewind: true,
        });
      }
    }

    return { nodes: nodeList, edges: synthesizedEdges };
  }, [prd, storySections]);

  // 2. 黄金居中骨干与对称左右分支排版算法
  const layout = useMemo(() => {
    if (nodes.length === 0) {
      return { positionedNodes: [], positionedEdges: [], bounds: { w: 800, h: 600 }, backboneIds: new Set<string>() };
    }

    const NODE_W = 220;
    const NODE_H = 88;
    const X_GAP = 90;
    const Y_GAP = 82;
    const X_STEP = NODE_W + X_GAP;
    const Y_STEP = NODE_H + Y_GAP;

    const nodeMap = new Map<string, FilmTopoNode>(nodes.map((n) => [n.id, n]));
    const forwardEdges = edges.filter((e) => !e.isRewind);

    const outMap = new Map<string, string[]>();
    const inMap = new Map<string, string[]>();
    for (const e of forwardEdges) {
      outMap.set(e.from, [...(outMap.get(e.from) || []), e.to]);
      inMap.set(e.to, [...(inMap.get(e.to) || []), e.from]);
    }

    // 2.1 提取黄金主干 (Backbone Path)
    const backboneIds = new Set<string>();
    let curr: string | undefined = prd.startNodeId || nodes[0]?.id;
    const visited = new Set<string>();

    while (curr && !visited.has(curr)) {
      visited.add(curr);
      backboneIds.add(curr);
      const outs: string[] = outMap.get(curr) || [];
      if (outs.length === 0) break;

      // 优先沿 clip 主线前进
      const nextClip: string | undefined = outs.find((id: string) => nodeMap.get(id)?.kind === 'clip');
      const nextVictory: string | undefined = outs.find((id: string) => nodeMap.get(id)?.isVictory);
      curr = nextClip || nextVictory || outs[0];
    }

    // 2.2 计算拓扑层级 Row
    const rowMap = new Map<string, number>();
    const queue: string[] = [prd.startNodeId || nodes[0]?.id];
    rowMap.set(queue[0], 0);

    while (queue.length > 0) {
      const u = queue.shift()!;
      const r = rowMap.get(u) || 0;
      for (const v of outMap.get(u) || []) {
        const nextR = Math.max(rowMap.get(v) || 0, r + 1);
        if (nextR !== rowMap.get(v)) {
          rowMap.set(v, nextR);
          queue.push(v);
        }
      }
    }

    // 兜底未连接节点
    for (const n of nodes) {
      if (!rowMap.has(n.id)) {
        rowMap.set(n.id, n.kind === 'ending' ? 4 : 1);
      }
    }

    // 2.3 分支槽位左右对称分配 (Backbone slot=0, left < 0, right > 0)
    const slotMap = new Map<string, number>();
    let globalLeftCount = 0;
    let globalRightCount = 0;

    // 按 row 分组
    const rowBuckets = new Map<number, string[]>();
    for (const n of nodes) {
      const r = rowMap.get(n.id) || 0;
      rowBuckets.set(r, [...(rowBuckets.get(r) || []), n.id]);
    }

    const sortedRows = [...rowBuckets.keys()].sort((a, b) => a - b);
    for (const r of sortedRows) {
      const ids = rowBuckets.get(r) || [];
      const backboneNodes = ids.filter((id) => backboneIds.has(id));
      const branchNodes = ids.filter((id) => !backboneIds.has(id));

      for (const id of backboneNodes) {
        slotMap.set(id, 0);
      }

      for (const id of branchNodes) {
        if (globalLeftCount <= globalRightCount) {
          globalLeftCount += 1;
          slotMap.set(id, -globalLeftCount);
        } else {
          globalRightCount += 1;
          slotMap.set(id, globalRightCount);
        }
      }
    }

    // 2.4 计算绝对对称画布与居中坐标
    const maxSideSpan = Math.max(1, globalLeftCount, globalRightCount);
    const CenterX = 140 + maxSideSpan * X_STEP;
    const totalW = CenterX * 2;
    const maxRow = Math.max(...Array.from(rowMap.values()), 0);
    const totalH = Math.max(700, 140 + (maxRow + 1) * Y_STEP);

    const positionedNodes: PositionedFilmNode[] = nodes.map((node) => {
      const r = rowMap.get(node.id) || 0;
      const slot = slotMap.get(node.id) || 0;
      const x = CenterX + slot * X_STEP - NODE_W / 2;
      const y = 80 + r * Y_STEP;

      return {
        node,
        x,
        y,
        w: NODE_W,
        h: NODE_H,
        row: r,
        col: slot,
      };
    });

    const posMap = new Map<string, PositionedFilmNode>(positionedNodes.map((pn) => [pn.node.id, pn]));

    // 2.5 计算优雅光滑连线
    const positionedEdges: PositionedFilmEdge[] = [];
    for (const e of edges) {
      const fromNode = posMap.get(e.from);
      const toNode = posMap.get(e.to);
      if (!fromNode || !toNode) continue;

      const fromAnchors = getShapeAnchors(fromNode.node.shape, fromNode.w, fromNode.h);
      const toAnchors = getShapeAnchors(toNode.node.shape, toNode.w, toNode.h);

      let start = { x: fromNode.x + fromNode.w / 2, y: fromNode.y + fromNode.h };
      let end = { x: toNode.x + toNode.w / 2, y: toNode.y };
      let path = '';
      let lx = (start.x + end.x) / 2;
      let ly = (start.y + end.y) / 2;

      if (e.isRewind) {
        // 回溯向上右侧弧线
        start = { x: fromNode.x + fromAnchors.rightX, y: fromNode.y + fromNode.h / 2 };
        end = { x: toNode.x + toAnchors.rightX, y: toNode.y + toNode.h / 2 };
        const trackX = Math.max(fromNode.x + fromNode.w, toNode.x + toNode.w) + 40;
        path = `M ${start.x} ${start.y} H ${trackX} V ${end.y} H ${end.x}`;
        lx = trackX + 10;
        ly = (start.y + end.y) / 2;
      } else {
        // 顺向贝塞尔曲线
        const dy = end.y - start.y;
        const cpOffset = Math.max(30, Math.min(100, Math.abs(dy) * 0.5));
        path = `M ${start.x} ${start.y} C ${start.x} ${start.y + cpOffset}, ${end.x} ${end.y - cpOffset}, ${end.x} ${end.y}`;
        lx = (start.x + end.x) / 2;
        ly = (start.y + end.y) / 2;
      }

      positionedEdges.push({ edge: e, path, lx, ly });
    }

    return {
      positionedNodes,
      positionedEdges,
      bounds: { w: totalW, h: totalH },
      backboneIds,
    };
  }, [nodes, edges, prd.startNodeId]);

  // 视口初次加载自动水平居中于主轴
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || layout.positionedNodes.length === 0) return;
    const startNode = layout.positionedNodes.find((pn) => pn.node.isStart) || layout.positionedNodes[0];
    if (startNode) {
      el.scrollLeft = Math.max(0, startNode.x + startNode.w / 2 - el.clientWidth / 2);
    }
  }, [layout.positionedNodes]);

  // 鼠标拖拽平移支持
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    dragStateRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.active) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragStateRef.current.moved = true;
    }
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = dragStateRef.current.scrollLeft - dx;
      el.scrollTop = dragStateRef.current.scrollTop - dy;
    }
  };

  const handleMouseUp = () => {
    dragStateRef.current.active = false;
  };

  return (
    <div
      ref={scrollRef}
      className={`topo-diagram-viewport film-topo-viewport ${className}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="topo-stage-canvas" style={{ width: layout.bounds.w, height: layout.bounds.h }}>
        <svg
          className="topo-svg-layer"
          width={layout.bounds.w}
          height={layout.bounds.h}
          viewBox={`0 0 ${layout.bounds.w} ${layout.bounds.h}`}
        >
          <defs>
            <marker
              id="film-arrow-normal"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7" />
            </marker>
            <marker
              id="film-arrow-rewind"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#e11d48" />
            </marker>
          </defs>

          {/* 1. 连线层 */}
          <g className="topo-edges-group">
            {layout.positionedEdges.map(({ edge, path, lx, ly }) => {
              const isHovered = hoveredNodeId === edge.from || hoveredNodeId === edge.to;
              const isSelected = selectedNodeId === edge.from || selectedNodeId === edge.to;
              const strokeColor = edge.isRewind ? '#e11d48' : edge.isBranch ? '#d97706' : '#0284c7';
              const markerEnd = edge.isRewind ? 'url(#film-arrow-rewind)' : 'url(#film-arrow-normal)';

              return (
                <g key={edge.id} className="topo-edge-item">
                  <path
                    d={path}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.5}
                    strokeDasharray={edge.isRewind ? '4 3' : undefined}
                    opacity={isSelected || isHovered ? 1 : 0.65}
                    markerEnd={markerEnd}
                  />
                  {edge.shortLabel && (
                    <g transform={`translate(${lx}, ${ly})`} className="topo-edge-label-group">
                      <rect
                        x={-edge.shortLabel.length * 6 - 8}
                        y={-10}
                        width={edge.shortLabel.length * 12 + 16}
                        height={20}
                        rx={10}
                        fill="#ffffff"
                        stroke={strokeColor}
                        strokeWidth={0.8}
                      />
                      <text
                        x={0}
                        y={3.5}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#334155"
                        fontWeight={500}
                      >
                        {edge.shortLabel}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {/* 2. 节点层 */}
          <g className="topo-nodes-group">
            {layout.positionedNodes.map((pn) => {
              const isHovered = hoveredNodeId === pn.node.id;
              const isSelected = selectedNodeId === pn.node.id;
              const isBackbone = layout.backboneIds.has(pn.node.id);

              return (
                <g
                  key={pn.node.id}
                  ref={(el) => nodeRefs.current.set(pn.node.id, el)}
                  transform={`translate(${pn.x}, ${pn.y})`}
                  className={`topo-node-item ${isSelected ? 'selected' : ''}`}
                  onMouseEnter={() => setHoveredNodeId(pn.node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragStateRef.current.moved) return;
                    onSelectNode?.(pn.node.id);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <TopoNodeShape
                    shape={pn.node.shape}
                    w={pn.w}
                    h={pn.h}
                    fill={pn.node.bgColor}
                    stroke={isSelected ? '#0284c7' : isHovered ? '#0f172a' : pn.node.accentColor}
                    strokeWidth={isSelected ? 2.6 : isHovered ? 2.1 : 1.5}
                    doubleBorder={pn.node.kind === 'ending'}
                  />

                  {/* 节点文本内容 */}
                  <g className="topo-node-content" transform="translate(14, 16)">
                    <g className="topo-badge-row">
                      <rect
                        x={0}
                        y={0}
                        width={pn.node.badge.length * 10 + 12}
                        height={16}
                        rx={8}
                        fill={pn.node.badgeColor}
                        opacity={0.15}
                      />
                      <text
                        x={pn.node.badge.length * 5 + 6}
                        y={11.5}
                        textAnchor="middle"
                        fontSize={9.5}
                        fill={pn.node.badgeColor}
                        fontWeight={600}
                      >
                        {pn.node.badge}
                      </text>
                      {pn.node.shortTag && (
                        <text
                          x={pn.node.badge.length * 10 + 20}
                          y={11.5}
                          fontSize={9.5}
                          fill="#64748b"
                        >
                          {pn.node.shortTag}
                        </text>
                      )}
                    </g>

                    <text
                      x={0}
                      y={34}
                      fontSize={13}
                      fontWeight={600}
                      fill="#0f172a"
                      style={{ letterSpacing: '-0.01em' }}
                    >
                      {truncateText(pn.node.title, 14)}
                    </text>

                    <text
                      x={0}
                      y={51}
                      fontSize={11}
                      fill="#64748b"
                    >
                      {pn.node.subtitle}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
};
