/**
 * client/src/components/PlannerTopologyDiagram.tsx
 * 阶段一：竖向故事流向拓扑图组件 (Top-Down Pure Native SVG)
 *
 * 采用「自上而下分层流向 + 多路并行展开 + 局部右侧回溯轨道」排版，
 * 将片段剧情、互动点、结局统一可视化，支持滚轮/拖拽浏览、缩放与点击联动定位。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  UniversalPrdSpec,
  StorySectionItem,
  PrdInteractionNode,
  PrdEndingNode,
} from '../types/index.js';
import {
  TopoNodeShape,
  TopoLegendIcon,
  getShapeAnchors,
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
  storySections?: Record<string, StorySectionItem>;
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
  const clean = text.replace(/\s+/g, ' ').trim();
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
    HOLD: '长按互动',
    TAP_HOTSPOT: '热点点击',
    WIPE: '擦拭探索',
    INPUT: '文本输入',
    QTE: '限时QTE',
  };
  return map[upper] || upper;
}

export const PlannerTopologyDiagram: React.FC<PlannerTopologyDiagramProps> = ({
  prd,
  storySections,
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

  // 点击详情卡「回到节点」时，精准平滑滚动居中并短暂脉冲高亮对应拓扑节点
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

  // 1. 组装三类节点与全部有向边（100% 基于 UniversalPrdSpec）
  const { nodes, edges, forwardEdges } = useMemo(() => {
    const nodeList: PlannerTopoNode[] = [];
    const nodeMap = new Map<string, PlannerTopoNode>();
    const interMap = new Map<string, PrdInteractionNode>(
      prd.interactions.map((i) => [i.id, i])
    );
    const endingMap = new Map<string, PrdEndingNode>(
      prd.endings.map((e) => [e.id, e])
    );

    // 1.1 片段剧情节点
    for (const clip of prd.clips) {
      const isStart = clip.id === prd.startNodeId;
      const sec = storySections?.[clip.id];
      const storySnippet = sec?.narrativeText
        ? truncateText(sec.narrativeText, 24)
        : `视频切片 ${clip.video}`;

      const node: PlannerTopoNode = {
        id: clip.id,
        kind: 'clip',
        shape: 'rect',
        title: clip.title || sec?.title || clip.id,
        subtitle: storySnippet,
        shortTag: isStart ? '起点' : undefined,
        badge: isStart ? '起点片段' : '剧情片段',
        badgeColor: '#0284c7',
        accentColor: '#0284c7',
        bgColor: '#f0f9ff',
        isStart,
      };
      nodeList.push(node);
      nodeMap.set(node.id, node);
    }

    // 1.2 互动点节点
    for (const inter of prd.interactions) {
      const hasStateChange = summarizeStateChange(inter);
      const kindLabel = formatInteractionKindLabel(inter.kind);
      const outcomeCount = inter.outcomes?.length || 0;
      const node: PlannerTopoNode = {
        id: inter.id,
        kind: 'interaction',
        shape: 'hexagon',
        title: kindLabel,
        subtitle: truncateText(inter.prompt || `${outcomeCount} 个结果`, 24),
        shortTag: typeof inter.timeoutSec === 'number' ? `⏱${inter.timeoutSec}s` : undefined,
        badge:
          typeof inter.timeoutSec === 'number'
            ? `互动 ⏱️${inter.timeoutSec}s`
            : `互动 (${outcomeCount}结果)`,
        badgeColor: '#d97706',
        accentColor: '#d97706',
        bgColor: '#fffbeb',
        hasStateChange,
        timeoutSec: inter.timeoutSec,
      };
      nodeList.push(node);
      nodeMap.set(node.id, node);
    }

    // 1.3 结局节点
    for (const ending of prd.endings) {
      const isVictory = Boolean(ending.isVictory);
      const node: PlannerTopoNode = {
        id: ending.id,
        kind: 'ending',
        shape: 'octagon',
        title: ending.title || ending.id,
        subtitle: truncateText(
          ending.rewindTargetClipId
            ? `可回溯至 ${ending.rewindTargetClipId}`
            : ending.summary || `${ending.endingType} 结局`,
          24
        ),
        shortTag: ending.endingType,
        badge: `${ending.endingType} · ${isVictory ? '通关' : '终局'}`,
        badgeColor: isVictory ? '#059669' : '#e11d48',
        accentColor: isVictory ? '#059669' : '#e11d48',
        bgColor: isVictory ? '#ecfdf5' : '#fff1f2',
        isVictory,
      };
      nodeList.push(node);
      nodeMap.set(node.id, node);
    }

    // 1.4 接线边
    const allEdges: PlannerTopoEdge[] = [];
    const fwdEdges: PlannerTopoEdge[] = [];

    prd.wiring.forEach((w, idx) => {
      if (!nodeMap.has(w.from) || !nodeMap.has(w.to)) return;

      const sourceInter = interMap.get(w.from);
      const outcomeObj = sourceInter?.outcomes?.find((o) => o.key === w.onOutcome);
      const isTimeout = w.onOutcome === 'TIMEOUT';

      let kind: TopoEdgeKind = 'normal';
      const labelParts: string[] = [];

      if (isTimeout) {
        kind = 'timeout';
        labelParts.push('⏱️ 超时');
      } else if (w.onOutcome !== 'onEnded' && w.onOutcome !== '*') {
        kind = 'choice';
        const outcomeLabel = outcomeObj?.label;
        labelParts.push(
          outcomeLabel && outcomeLabel !== w.onOutcome
            ? `${w.onOutcome}·${outcomeLabel}`
            : w.onOutcome
        );
      }

      if (w.condition) {
        if (kind === 'normal') kind = 'conditional';
        labelParts.push(`若 ${w.condition}`);
      } else if (w.transition?.text) {
        labelParts.push(`🎬 ${w.transition.text}`);
      }

      const fullLabel =
        labelParts.length > 0
          ? labelParts.join(' | ')
          : w.onOutcome === 'onEnded'
          ? '播完继续'
          : '触发继续';
      // 抉择/流转文字在下方节点详情中展示，拓扑连线上仅保留超时标识与回溯标识，保持版面简洁
      const shortLabel = isTimeout ? '⏱️ 超时' : '';

      const edge: PlannerTopoEdge = {
        id: `w_${idx}_${w.from}_${w.to}`,
        from: w.from,
        to: w.to,
        kind,
        shortLabel,
        fullLabel,
        condition: w.condition,
        transitionText: w.transition?.text ?? null,
      };
      allEdges.push(edge);
      fwdEdges.push(edge);
    });

    // 1.5 结局回溯边（不参与正向分层）
    for (const ending of prd.endings) {
      if (ending.rewindTargetClipId && nodeMap.has(ending.rewindTargetClipId)) {
        allEdges.push({
          id: `rewind_${ending.id}_${ending.rewindTargetClipId}`,
          from: ending.id,
          to: ending.rewindTargetClipId,
          kind: 'rewind',
          shortLabel: '🔄 回溯',
          fullLabel: `回溯重选 ➔ ${ending.rewindTargetClipId}`,
        });
      }
    }

    return { nodes: nodeList, edges: allEdges, forwardEdges: fwdEdges };
  }, [prd, storySections]);

  // 2. 竖向 Top-Down DAG 分层排布算法（自上而下分层 + 多路并列 + 局部右廊回溯）
  const layout = useMemo(() => {
    if (nodes.length === 0) {
      return { positionedNodes: [] as PositionedNode[], positionedEdges: [] as PositionedEdge[], width: 720, height: 360 };
    }

    const NW = 192;
    const NH = 54;
    const COL_GAP = 64;
    const ROW_GAP = 48;
    const PAD_X = 48;
    const PAD_Y = 38;
    const LEFT_CORRIDOR = 44; // 同列跨行绕避预留左侧走廊

    const nodeIds = nodes.map((n) => n.id);
    const idOrder = new Map(nodeIds.map((id, i) => [id, i]));
    const adj = new Map<string, string[]>();
    nodeIds.forEach((id) => adj.set(id, []));
    forwardEdges.forEach((e) => {
      if (e.from !== e.to) adj.get(e.from)?.push(e.to);
    });

    // 2.1 DFS 识别正向边与环回边
    const visitState = new Map<string, 0 | 1 | 2>();
    const backEdgePairs = new Set<string>();
    const dfsOrder: string[] = [];
    const startRoot = prd.startNodeId && adj.has(prd.startNodeId) ? prd.startNodeId : nodeIds[0];

    const dfs = (u: string) => {
      visitState.set(u, 1);
      for (const v of adj.get(u) || []) {
        const st = visitState.get(v) ?? 0;
        if (st === 1) {
          backEdgePairs.add(`${u}\u0000${v}`);
        } else if (st === 0) {
          dfs(v);
        }
      }
      visitState.set(u, 2);
      dfsOrder.push(u);
    };

    dfs(startRoot);
    for (const id of nodeIds) {
      if ((visitState.get(id) ?? 0) === 0) dfs(id);
    }

    // 2.2 Longest-Path 计算自上而下行号 row
    const dagOut = new Map<string, string[]>();
    nodeIds.forEach((id) => dagOut.set(id, []));
    for (const e of forwardEdges) {
      if (e.from === e.to || backEdgePairs.has(`${e.from}\u0000${e.to}`)) continue;
      if (!dagOut.get(e.from)!.includes(e.to)) {
        dagOut.get(e.from)!.push(e.to);
      }
    }

    const rank = new Map<string, number>();
    nodeIds.forEach((id) => rank.set(id, 0));
    const topoOrder = [...dfsOrder].reverse();
    for (const u of topoOrder) {
      const r = rank.get(u) ?? 0;
      for (const v of dagOut.get(u) || []) {
        if ((rank.get(v) ?? 0) < r + 1) {
          rank.set(v, r + 1);
        }
      }
    }

    // 2.2.1 智能抽取故事黄金主干路径 (Golden Spine Extraction)
    // 采用反向 DP + 故事权重评估，从 startRoot 寻找一条通往终局（优先胜利结局）的核心链路
    const nodeMap = new Map<string, PlannerTopoNode>(nodes.map((n) => [n.id, n]));
    const bestScore = new Map<string, number>();
    const bestNext = new Map<string, string>();

    // 逆拓扑序计算最优主干分值
    for (const u of dfsOrder) {
      const uNode = nodeMap.get(u);
      const isTerminal = (dagOut.get(u) || []).length === 0;
      if (isTerminal) {
        const terminalScore = uNode?.isVictory ? 200 : uNode?.kind === 'ending' ? 60 : 30;
        bestScore.set(u, terminalScore);
      } else {
        let maxS = -Infinity;
        let chosenNext = '';
        for (const v of dagOut.get(u) || []) {
          const vNode = nodeMap.get(v);
          const edgeObj = forwardEdges.find((e) => e.from === u && e.to === v);
          let edgeWeight = 10;
          if (edgeObj?.kind === 'normal') edgeWeight = 30; // 剧情片段平滑顺向推进
          else if (edgeObj?.kind === 'choice') edgeWeight = 15;
          else if (edgeObj?.kind === 'conditional') edgeWeight = 10;
          else if (edgeObj?.kind === 'timeout') edgeWeight = -25; // 超时通常非主线
          
          if (vNode?.isVictory) edgeWeight += 60;
          else if (vNode?.kind === 'ending' && !vNode?.isVictory) edgeWeight -= 40; // 失败结局避开主干

          const totalCandidate = edgeWeight + (bestScore.get(v) ?? 0);
          if (totalCandidate > maxS) {
            maxS = totalCandidate;
            chosenNext = v;
          }
        }
        bestScore.set(u, maxS);
        if (chosenNext) bestNext.set(u, chosenNext);
      }
    }

    // 正向追踪组装主干集合
    const backboneSet = new Set<string>();
    let currTrack: string | undefined = startRoot;
    const visitedInTrack = new Set<string>();
    while (currTrack && !visitedInTrack.has(currTrack)) {
      backboneSet.add(currTrack);
      visitedInTrack.add(currTrack);
      currTrack = bestNext.get(currTrack);
    }

    // 2.3 依据主干中轴与跨行交替均衡策略，为同行节点分配居中及左右对称的槽位 (Slots)
    // slot = 0 为正中主轴，负数为左翼分支 (-1, -2...)，正数为右翼分支 (+1, +2...)
    const rows = new Map<number, PlannerTopoNode[]>();
    nodes.forEach((n) => {
      const r = rank.get(n.id) ?? 0;
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r)!.push(n);
    });

    const sortedRows = [...rows.keys()].sort((a, b) => a - b);
    const nodeSlots = new Map<string, number>();

    // 全局分支左右翼累计计数，用于跨行交替对称平衡
    let globalLeftBranchCount = 0;
    let globalRightBranchCount = 0;

    sortedRows.forEach((rowIdx) => {
      const rowNodes = rows.get(rowIdx)!;
      if (rowNodes.length === 1) {
        // 单个节点直接锁定居中中轴线 slot = 0
        nodeSlots.set(rowNodes[0].id, 0);
        return;
      }

      // 多节点行：找出主干节点（若有）
      const bbIndex = rowNodes.findIndex((n) => backboneSet.has(n.id));

      if (bbIndex !== -1) {
        // 存在主干节点：主干锁定居中 slot = 0
        const bbNode = rowNodes[bbIndex];
        nodeSlots.set(bbNode.id, 0);

        const branches = rowNodes.filter((_, idx) => idx !== bbIndex);
        const leftPool: PlannerTopoNode[] = [];
        const rightPool: PlannerTopoNode[] = [];

        branches.forEach((bNode) => {
          const isBadEnding = bNode.kind === 'ending' && !bNode.isVictory;
          const isTimeout = Boolean(bNode.shortTag?.includes('⏱') || bNode.badge.includes('⏱'));
          if (isBadEnding || isTimeout) {
            leftPool.push(bNode);
            globalLeftBranchCount++;
          } else if (bNode.isVictory) {
            rightPool.push(bNode);
            globalRightBranchCount++;
          } else {
            // 普通分支：根据全局配重交替分配至左翼或右翼，避免单侧堆积
            if (globalLeftBranchCount <= globalRightBranchCount) {
              leftPool.push(bNode);
              globalLeftBranchCount++;
            } else {
              rightPool.push(bNode);
              globalRightBranchCount++;
            }
          }
        });

        // 均衡两翼数量，保持同行左右对称
        while (leftPool.length > rightPool.length + 1) {
          rightPool.unshift(leftPool.pop()!);
        }
        while (rightPool.length > leftPool.length + 1) {
          leftPool.unshift(rightPool.pop()!);
        }

        leftPool.forEach((n, i) => {
          nodeSlots.set(n.id, -(i + 1));
        });
        rightPool.forEach((n, i) => {
          nodeSlots.set(n.id, i + 1);
        });
      } else {
        // 本行无主干节点（如同级分歧推进）：围绕 0 轴左右对称展开
        const total = rowNodes.length;
        if (total % 2 === 1) {
          const half = Math.floor(total / 2);
          rowNodes.forEach((n, i) => {
            nodeSlots.set(n.id, i - half);
          });
        } else {
          // 偶数个：[-half, ..., -1, +1, ..., +half]
          const half = total / 2;
          rowNodes.forEach((n, i) => {
            const slot = i < half ? i - half : i - half + 1;
            nodeSlots.set(n.id, slot);
          });
        }
      }
    });

    // 2.4 计算全局槽位极值与严格几何中心轴 X 坐标
    let minSlot = 0;
    let maxSlot = 0;
    nodeSlots.forEach((s) => {
      if (s < minSlot) minSlot = s;
      if (s > maxSlot) maxSlot = s;
    });

    const leftSpan = Math.abs(Math.min(0, minSlot));
    const rightSpan = Math.max(0, maxSlot);
    const maxHalfSlots = Math.max(leftSpan, rightSpan, 1);

    const reverseEdgeCount = edges.filter(
      (e) => e.kind === 'rewind' || (rank.get(e.to) ?? 0) <= (rank.get(e.from) ?? 0)
    ).length;
    const corridorReserve = Math.max(48, reverseEdgeCount * 44 + 48);

    // 严密对称计算：让主干正处于 50% 绝对几何正中央
    const wingWidth = maxHalfSlots * (NW + COL_GAP);
    const sidePadding = Math.max(PAD_X + LEFT_CORRIDOR, PAD_X + corridorReserve);
    const CenterX = sidePadding + wingWidth + NW / 2;
    const totalW = CenterX * 2; // 画布总宽恒为 CenterX 的两倍，主干百分百居中

    const posMap = new Map<string, PositionedNode>();
    const positionedNodes: PositionedNode[] = [];

    sortedRows.forEach((rowIdx) => {
      const rowNodes = rows.get(rowIdx)!;

      rowNodes.forEach((node) => {
        const slot = nodeSlots.get(node.id) ?? 0;
        const item: PositionedNode = {
          node,
          x: CenterX + slot * (NW + COL_GAP) - NW / 2,
          y: PAD_Y + rowIdx * (NH + ROW_GAP),
          w: NW,
          h: NH,
          row: rowIdx,
          col: slot,
        };
        posMap.set(node.id, item);
        positionedNodes.push(item);
      });
    });

    // 记录每行最右侧边界，供局部右侧回溯轨道精准贴合
    const rowMaxRightMap = new Map<number, number>();
    positionedNodes.forEach((pn) => {
      const right = pn.x + pn.w;
      if ((rowMaxRightMap.get(pn.row) ?? 0) < right) {
        rowMaxRightMap.set(pn.row, right);
      }
    });

    // 2.5 计算垂直流向边 + 局部不碰撞右侧回溯轨道
    const outgoingEdgesMap = new Map<string, PlannerTopoEdge[]>();
    const pairEdgesMap = new Map<string, PlannerTopoEdge[]>();
    edges.forEach((e) => {
      if (!outgoingEdgesMap.has(e.from)) outgoingEdgesMap.set(e.from, []);
      outgoingEdgesMap.get(e.from)!.push(e);

      const pairKey = `${e.from}\u0000${e.to}`;
      if (!pairEdgesMap.has(pairKey)) pairEdgesMap.set(pairKey, []);
      pairEdgesMap.get(pairKey)!.push(e);
    });

    const positionedEdges: PositionedEdge[] = [];
    // 右侧回溯轨道占用记录：[minRow, maxRow, corridorX]
    const reverseTracks: Array<{ minRow: number; maxRow: number; corridorX: number }> = [];

    edges.forEach((edge) => {
      const fromPos = posMap.get(edge.from);
      const toPos = posMap.get(edge.to);
      if (!fromPos || !toPos) return;

      const isReverse = edge.kind === 'rewind' || toPos.row <= fromPos.row;

      if (isReverse) {
        const minRow = Math.min(fromPos.row, toPos.row);
        const maxRow = Math.max(fromPos.row, toPos.row);
        let localRight = fromPos.x + fromPos.w;
        for (let r = minRow; r <= maxRow; r++) {
          localRight = Math.max(localRight, rowMaxRightMap.get(r) ?? 0);
        }

        // 寻找与现有轨道在 [minRow..maxRow] 互不重叠的最近右侧轨道
        let trackIdx = 0;
        let corridorX = localRight + 54;
        while (
          reverseTracks.some(
            (t) =>
              !(maxRow < t.minRow || minRow > t.maxRow) &&
              Math.abs(t.corridorX - corridorX) < 42
          )
        ) {
          trackIdx++;
          corridorX = localRight + 54 + trackIdx * 48;
        }
        reverseTracks.push({ minRow, maxRow, corridorX });

        const fromAnchors = getShapeAnchors(fromPos.node.shape, fromPos.w, fromPos.h);
        const toAnchors = getShapeAnchors(toPos.node.shape, toPos.w, toPos.h);
        const sx = fromPos.x + fromAnchors.rightX;
        const sy = fromPos.y + fromPos.h / 2;

        // 判断目标行右侧是否有同排其他卡片挡路：若没有，直接接入目标卡片右侧中点；若有，改绕入目标上方间隙
        const toRowHasRightSiblings = positionedNodes.some(
          (pn) => pn.row === toPos.row && pn.x > toPos.x
        );

        let path: string;
        let lx: number;
        let ly: number;

        if (!toRowHasRightSiblings) {
          const ex = toPos.x + toAnchors.rightX;
          const ey = toPos.y + toPos.h / 2;
          path = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${corridorX.toFixed(1)} ${sy.toFixed(1)}, ${corridorX.toFixed(1)} ${ey.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
          lx = 0.125 * sx + 0.75 * corridorX + 0.125 * ex;
          ly = (sy + ey) / 2;
        } else {
          const ex = toPos.x + toPos.w / 2 + 28;
          const ey = toPos.y;
          const topApproachY = toPos.y - 24;
          path = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${corridorX.toFixed(1)} ${sy.toFixed(1)}, ${corridorX.toFixed(1)} ${topApproachY.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
          lx = 0.125 * sx + 0.75 * corridorX + 0.125 * ex;
          ly = (sy + ey) / 2;
        }

        positionedEdges.push({ edge, path, lx, ly });
        return;
      }

      // 前向边：底出 ➔ 顶入
      const outList = outgoingEdgesMap.get(edge.from) || [edge];
      const outIdx = outList.indexOf(edge);
      const outSpan = Math.min(fromPos.w * 0.44, Math.max(0, (outList.length - 1) * 28));
      const xOffsetFrom =
        outList.length > 1
          ? -outSpan / 2 + (outSpan * outIdx) / (outList.length - 1)
          : 0;

      const pairKey = `${edge.from}\u0000${edge.to}`;
      const pairList = pairEdgesMap.get(pairKey) || [edge];
      const pairIdx = pairList.indexOf(edge);
      const pairSpread =
        pairList.length > 1 ? (pairIdx - (pairList.length - 1) / 2) * 34 : 0;

      const sx = fromPos.x + fromPos.w / 2 + xOffsetFrom;
      const sy = fromPos.y + fromPos.h;
      const ex = toPos.x + toPos.w / 2 + pairSpread * 0.35;
      const ey = toPos.y;

      // 跨越多行的垂直边若同列中间有其它卡片阻挡，向外侧平滑弯曲避障
      let bypassXShift = pairSpread;
      if (toPos.row - fromPos.row > 1 && Math.abs(pairSpread) < 1) {
        const minMidX = Math.min(sx, ex) - 24;
        const maxMidX = Math.max(sx, ex) + 24;
        const hasMiddleCollision = positionedNodes.some(
          (pn) =>
            pn.row > fromPos.row &&
            pn.row < toPos.row &&
            pn.x + pn.w >= minMidX &&
            pn.x <= maxMidX
        );
        if (hasMiddleCollision) {
          const outwardDir = sx >= CenterX ? 1 : -1;
          bypassXShift = outwardDir * (NW * 0.52 + COL_GAP * 0.4);
        }
      }

      const dy = Math.max(36, ey - sy);
      const cp1x = sx + bypassXShift;
      const cp1y = sy + dy * 0.42;
      const cp2x = ex + bypassXShift;
      const cp2y = ey - dy * 0.42;

      const path = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;

      // 对发散分叉（例如一节点多分支连向同排多个结局），标签放在 t = 0.58 稍靠下游的位置避免相互重叠
      const t = outList.length > 2 ? 0.6 : 0.5;
      const mt = 1 - t;
      const lx =
        mt * mt * mt * sx +
        3 * mt * mt * t * cp1x +
        3 * mt * t * t * cp2x +
        t * t * t * ex;
      const ly =
        mt * mt * mt * sy +
        3 * mt * mt * t * cp1y +
        3 * mt * t * t * cp2y +
        t * t * t * ey;

      positionedEdges.push({ edge, path, lx, ly });
    });

    const totalH = Math.max(
      360,
      PAD_Y * 2 + sortedRows.length * NH + Math.max(0, sortedRows.length - 1) * ROW_GAP
    );

    return { positionedNodes, positionedEdges, width: totalW, height: totalH };
  }, [nodes, edges, forwardEdges, prd.startNodeId]);

  // 初始加载或画布尺寸变化时，自动将中轴主干平滑居中在视窗可视区域正中央
  useEffect(() => {
    if (scrollRef.current && layout.width > 0) {
      const containerWidth = scrollRef.current.clientWidth;
      if (layout.width > containerWidth) {
        scrollRef.current.scrollLeft = Math.round((layout.width - containerWidth) / 2);
      }
    }
  }, [layout.width]);

  const focusNodeId = hoveredNodeId || selectedNodeId || null;

  const { relatedNodeIds, relatedEdgeIds } = useMemo(() => {
    const rNodes = new Set<string>();
    const rEdges = new Set<string>();
    if (!focusNodeId) return { relatedNodeIds: rNodes, relatedEdgeIds: rEdges };
    rNodes.add(focusNodeId);
    edges.forEach((e) => {
      if (e.from === focusNodeId || e.to === focusNodeId) {
        rEdges.add(e.id);
        rNodes.add(e.from);
        rNodes.add(e.to);
      }
    });
    return { relatedNodeIds: rNodes, relatedEdgeIds: rEdges };
  }, [focusNodeId, edges]);

  const edgeStyle = (kind: TopoEdgeKind, highlighted: boolean) => {
    switch (kind) {
      case 'choice':
        return {
          stroke: highlighted ? '#0284c7' : '#38bdf8',
          marker: highlighted ? 'url(#p-arrow-active)' : 'url(#p-arrow-choice)',
          dash: undefined,
        };
      case 'conditional':
        return {
          stroke: highlighted ? '#d97706' : '#f59e0b',
          marker: 'url(#p-arrow-amber)',
          dash: '6 3',
        };
      case 'timeout':
        return {
          stroke: '#e11d48',
          marker: 'url(#p-arrow-rose)',
          dash: '5 4',
        };
      case 'rewind':
        return {
          stroke: '#7c3aed',
          marker: 'url(#p-arrow-violet)',
          dash: '6 4',
        };
      default:
        return {
          stroke: highlighted ? '#2563eb' : '#94a3b8',
          marker: highlighted ? 'url(#p-arrow-active)' : 'url(#p-arrow-normal)',
          dash: undefined,
        };
    }
  };

  return (
    <div className="topo-board">
      <div className="topo-toolbar">
        <div className="topo-legend">
          <span className="topo-legend-item">
            <TopoLegendIcon shape="rect" stroke="#0284c7" fill="#f0f9ff" /> 剧情 ({prd.clips.length})
          </span>
          <span className="topo-legend-item">
            <TopoLegendIcon shape="hexagon" stroke="#d97706" fill="#fffbeb" /> 互动 ({prd.interactions.length})
          </span>
          <span className="topo-legend-item">
            <TopoLegendIcon shape="octagon" stroke="#059669" fill="#ecfdf5" doubleBorder /> 结局 ({prd.endings.length})
          </span>
          <span className="topo-legend-item" style={{ color: '#7c3aed' }}>
            ┄ 回溯
          </span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="topo-canvas-scroll"
        onMouseDown={(ev) => {
          if (ev.button !== 0 || !scrollRef.current) return;
          dragStateRef.current = {
            active: true,
            moved: false,
            startX: ev.clientX,
            startY: ev.clientY,
            scrollLeft: scrollRef.current.scrollLeft,
            scrollTop: scrollRef.current.scrollTop,
          };
        }}
        onMouseMove={(ev) => {
          const st = dragStateRef.current;
          if (!st.active || !scrollRef.current) return;
          const dx = ev.clientX - st.startX;
          const dy = ev.clientY - st.startY;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
            st.moved = true;
          }
          if (st.moved) {
            scrollRef.current.scrollLeft = st.scrollLeft - dx;
            scrollRef.current.scrollTop = st.scrollTop - dy;
          }
        }}
        onMouseUp={() => {
          dragStateRef.current.active = false;
        }}
        onMouseLeave={() => {
          dragStateRef.current.active = false;
        }}
      >
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{
            width: '100%',
            minWidth: `${layout.width}px`,
            height: 'auto',
            display: 'block',
          }}
        >
          <defs>
            <pattern id="planner-topo-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#e2e8f0" strokeWidth="0.8" strokeOpacity="0.8" />
            </pattern>
            <filter id="planner-node-glow" x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#2563eb" floodOpacity="0.3" />
            </filter>
            <marker id="p-arrow-normal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8" />
            </marker>
            <marker id="p-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563eb" />
            </marker>
            <marker id="p-arrow-choice" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#0284c7" />
            </marker>
            <marker id="p-arrow-amber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#d97706" />
            </marker>
            <marker id="p-arrow-rose" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#e11d48" />
            </marker>
            <marker id="p-arrow-violet" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#7c3aed" />
            </marker>
          </defs>

          <rect
            width={layout.width}
            height={layout.height}
            fill="url(#planner-topo-grid)"
            onClick={() => {
              if (dragStateRef.current.moved) return;
              onClearSelection?.();
            }}
          />

          {/* 连线层 */}
          {layout.positionedEdges.map(({ edge, path, lx, ly }) => {
            const isHighlighted = focusNodeId ? relatedEdgeIds.has(edge.id) : false;
            const isDimmed = focusNodeId ? !isHighlighted : false;
            const style = edgeStyle(edge.kind, isHighlighted);
            const pillW = Math.min(136, Math.max(48, edge.shortLabel.length * 10 + 18));

            return (
              <g key={edge.id} opacity={isDimmed ? 0.2 : 1} style={{ transition: 'opacity 0.2s' }}>
                <title>{`${edge.from} ➔ ${edge.to} (${edge.fullLabel})`}</title>
                <path
                  d={path}
                  fill="none"
                  stroke={style.stroke}
                  strokeWidth={isHighlighted ? 2.6 : 1.75}
                  strokeDasharray={style.dash}
                  markerEnd={style.marker}
                />
                {edge.shortLabel && (
                  <g transform={`translate(${lx.toFixed(1)}, ${ly.toFixed(1)})`}>
                    <rect
                      x={-pillW / 2}
                      y={-10}
                      width={pillW}
                      height={20}
                      rx={10}
                      fill="#ffffff"
                      stroke={style.stroke}
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fill="#334155"
                      fontSize="9.5"
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

          {/* 节点层（不同语义使用不同几何形状，卡片内只保留 ID + 简洁标题） */}
          {layout.positionedNodes.map(({ node, x, y, w, h }) => {
            const isSelected = selectedNodeId === node.id;
            const isHovered = hoveredNodeId === node.id;
            const isPulsing = pulsingNodeId === node.id;
            const isRelated = focusNodeId ? relatedNodeIds.has(node.id) : true;
            const isInteraction = node.kind === 'interaction';
            const strokeColor = isSelected ? '#2563eb' : isHovered ? '#0f172a' : node.accentColor;

            return (
              <g
                key={node.id}
                ref={(el) => {
                  if (el) nodeRefs.current.set(node.id, el);
                  else nodeRefs.current.delete(node.id);
                }}
                data-node-id={node.id}
                className="topo-svg-node"
                transform={`translate(${x}, ${y})`}
                opacity={focusNodeId && !isRelated ? 0.32 : 1}
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

                {isPulsing && (
                  <g transform="translate(-7, -7)" pointerEvents="none">
                    <g className="topo-node-return-pulse">
                      <TopoNodeShape
                        shape={node.shape}
                        w={w + 14}
                        h={h + 14}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth={2.5}
                      />
                    </g>
                  </g>
                )}

                <TopoNodeShape
                  shape={node.shape}
                  w={w}
                  h={h}
                  fill={node.bgColor}
                  stroke={strokeColor}
                  strokeWidth={isSelected ? 2.6 : isHovered ? 2.1 : 1.5}
                  strokeDasharray={isInteraction && !isSelected ? '5 2' : undefined}
                  doubleBorder={node.kind === 'ending'}
                  filter={isSelected ? 'url(#planner-node-glow)' : undefined}
                />

                <text
                  x={w / 2}
                  y={19}
                  fill={isSelected ? '#2563eb' : '#64748b'}
                  fontSize="10"
                  fontWeight={700}
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {node.shortTag
                    ? `${truncateText(node.id, 11)} · ${node.shortTag}`
                    : truncateText(node.id, 14)}
                </text>

                <text
                  x={w / 2}
                  y={38}
                  fill="#0f172a"
                  fontSize="12.5"
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
