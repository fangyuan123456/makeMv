import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  GitBranch,
  X,
  Sparkles,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';

export interface StoryNode {
  id: string;
  type?: string;
  title: string;
  summary?: string;
  isEnding?: boolean;
  endingType?: string;
  estimatedDurationSec?: number;
  choices?: Array<{
    targetNodeId?: string;
    toNodeId?: string;
    text?: string;
    choiceText?: string;
    id?: string;
  }>;
}

export interface StoryChoice {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  choiceText: string;
}

export interface InteractiveStoryGraph {
  startNodeId?: string;
  rootNodeId?: string;
  nodes?: StoryNode[];
  choices?: StoryChoice[];
}

interface StoryGraphViewerProps {
  graph?: InteractiveStoryGraph;
  onRegenerateGraph?: () => void;
  isRunning?: boolean;
}

export default function StoryGraphViewer({
  graph,
  onRegenerateGraph,
  isRunning,
}: StoryGraphViewerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 悬停气泡浮层 Tooltip 状态（仅在大图弹窗打开时生效）
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    title: string;
    badge?: string;
    badgeColor?: string;
    content: string;
    details?: string[];
  } | null>(null);

  // 大图弹窗内的交互状态：缩放与拖拽
  const [zoomScale, setZoomScale] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // 打开/关闭弹窗时重置状态
  useEffect(() => {
    if (isModalOpen) {
      setZoomScale(1.0);
      setPanOffset({ x: 0, y: 0 });
    } else {
      setTooltip(null);
    }
  }, [isModalOpen]);

  // 监听 ESC 键关闭弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  // 1. 安全提取节点列表
  const nodes: StoryNode[] = useMemo(() => {
    return (graph?.nodes || []).map((n: any) => ({
      ...n,
      type:
        n.type ||
        (n.isEnding
          ? n.endingType === 'bad'
            ? 'bad_end'
            : 'true_end'
          : n.choices && n.choices.length > 1
          ? 'decision'
          : 'plot'),
    }));
  }, [graph?.nodes]);

  // 2. 安全提取选择分支连线
  const choices: StoryChoice[] = useMemo(() => {
    if (graph?.choices && graph.choices.length > 0) return graph.choices;
    const list: StoryChoice[] = [];
    (graph?.nodes || []).forEach((n: any) => {
      if (Array.isArray(n.choices)) {
        n.choices.forEach((c: any, idx: number) => {
          const target = c.targetNodeId || c.toNodeId;
          if (target) {
            list.push({
              id: c.id || `${n.id}_c_${idx}`,
              fromNodeId: n.id,
              toNodeId: target,
              choiceText: c.text || c.choiceText || '分支路线',
            });
          }
        });
      }
    });
    return list;
  }, [graph?.choices, graph?.nodes]);

  // 3. 紧凑型 DAG 分层拓扑布局
  const layout = useMemo(() => {
    if (!nodes.length) {
      return { nodesWithPos: [], edgePaths: [], ingressLabels: [], width: 960, height: 420 };
    }

    const startId = (graph as any)?.rootNodeId || graph?.startNodeId || nodes[0]?.id;
    const outgoing = new Map<string, string[]>();
    nodes.forEach((n) => outgoing.set(n.id, []));
    choices.forEach((c) => {
      if (outgoing.has(c.fromNodeId) && c.toNodeId) {
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
    const cardWidth = 200;
    const cardHeight = 105;
    const colSpacing = 110;
    const rowSpacing = 35;
    const padX = 35;
    const padY = 35;

    let maxRows = 1;
    sortedCols.forEach((col) => {
      const count = columns.get(col)?.length || 0;
      if (count > maxRows) maxRows = count;
    });

    const totalWidth = padX * 2 + sortedCols.length * cardWidth + (sortedCols.length - 1) * colSpacing;
    const totalHeight = padY * 2 + maxRows * cardHeight + (maxRows - 1) * rowSpacing;

    const nodesWithPos: Array<{ node: StoryNode; x: number; y: number; w: number; h: number }> = [];
    const posMap = new Map<string, { x: number; y: number; w: number; h: number }>();

    sortedCols.forEach((colIdx) => {
      const colNodes = columns.get(colIdx) || [];
      const colTotalH = colNodes.length * cardHeight + (colNodes.length - 1) * rowSpacing;
      const startY = (totalHeight - colTotalH) / 2;

      colNodes.forEach((node, rowIdx) => {
        const x = padX + colIdx * (cardWidth + colSpacing);
        const y = startY + rowIdx * (cardHeight + rowSpacing);
        const item = { node, x, y, w: cardWidth, h: cardHeight };
        nodesWithPos.push(item);
        posMap.set(node.id, item);
      });
    });

    // 1. 连线路径层
    const edgePaths: string[] = [];
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

      edgePaths.push(`M ${sx} ${sy} C ${cp1x} ${sy}, ${cp2x} ${ey}, ${ex} ${ey}`);
    });

    // 2. 目标入口抉择胶囊（按目标节点归并去重，带完整文案供 Hover 气泡展示）
    const ingressLabels: Array<{
      toNodeId: string;
      label: string;
      fullText: string;
      x: number;
      y: number;
    }> = [];

    const seenTargets = new Set<string>();
    choices.forEach((c) => {
      if (seenTargets.has(c.toNodeId)) return;
      const to = posMap.get(c.toNodeId);
      if (!to) return;

      seenTargets.add(c.toNodeId);
      ingressLabels.push({
        toNodeId: c.toNodeId,
        label: c.choiceText,
        fullText: c.choiceText,
        x: to.x - 55,
        y: to.y + to.h / 2,
      });
    });

    return { nodesWithPos, edgePaths, ingressLabels, width: totalWidth, height: totalHeight };
  }, [nodes, choices, graph]);

  // 鼠标滚轮缩放事件（弹窗专用）
  const handleModalWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.88;
    setZoomScale((prev) => Math.min(3.5, Math.max(0.4, prev * factor)));
  };

  // 鼠标按住拖拽平移事件（弹窗专用）
  const handleModalMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX - panOffset.x,
      y: e.clientY - panOffset.y,
    };
  };

  const handleModalMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPanOffset({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  };

  const handleModalMouseUp = () => {
    setIsPanning(false);
  };

  // 空状态守卫
  if (!nodes || nodes.length === 0) {
    return (
      <div className="p-8 text-center bg-slate-900 rounded-2xl border border-dashed border-slate-700">
        <GitBranch className="w-10 h-10 text-slate-500 mx-auto mb-2" />
        <h4 className="text-xs font-bold text-slate-300">尚未生成网状拓扑图</h4>
        <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
          由叙事架构智能体自动根据故事圣经构建分支图谱。
        </p>
        {onRegenerateGraph && (
          <button
            onClick={onRegenerateGraph}
            disabled={isRunning}
            className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            一键规划分支拓扑
          </button>
        )}
      </div>
    );
  }

  // 纯矢量 SVG 内容渲染器
  // isInteractiveModal: 为 true 时才允许 hover 弹气泡，且卡片绝对保持静止（无任何动画晃动）
  const renderSvgGraph = (isInteractiveModal: boolean) => (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full block"
    >
      <defs>
        {/* 背景轻网格 */}
        <pattern id="diag-grid-pattern-shared" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#1e293b" strokeWidth="0.5" strokeOpacity="0.4" />
        </pattern>

        {/* 贝塞尔曲线渐变 */}
        <linearGradient id="diag-line-grad-shared" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0.95" />
        </linearGradient>

        {/* 终点箭头 */}
        <marker
          id="diag-arrow-head-shared"
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

      {/* 底色与网格 */}
      <rect width="100%" height="100%" fill="#070b12" />
      <rect width="100%" height="100%" fill="url(#diag-grid-pattern-shared)" />

      {/* 连线层 */}
      <g className="connections">
        {layout.edgePaths.map((d, idx) => (
          <path
            key={idx}
            d={d}
            fill="none"
            stroke="url(#diag-line-grad-shared)"
            strokeWidth="2.5"
            markerEnd="url(#diag-arrow-head-shared)"
          />
        ))}
      </g>

      {/* 目标入口分支抉择标签（仅大图支持 hover 气泡，卡片绝对静止） */}
      <g className="ingress-labels">
        {layout.ingressLabels.map((item, idx) => (
          <g
            key={idx}
            transform={`translate(${item.x}, ${item.y})`}
            className={isInteractiveModal ? 'cursor-default' : ''}
            onMouseEnter={
              isInteractiveModal
                ? (e) => {
                    setTooltip({
                      visible: true,
                      x: e.clientX,
                      y: e.clientY,
                      title: '分支核心抉择',
                      badge: '玩家路径选择',
                      badgeColor: '#6366f1',
                      content: item.fullText || item.label,
                      details: [`通往场景目标: #${item.toNodeId}`],
                    });
                  }
                : undefined
            }
            onMouseMove={
              isInteractiveModal
                ? (e) => {
                    setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
                  }
                : undefined
            }
            onMouseLeave={isInteractiveModal ? () => setTooltip(null) : undefined}
          >
            <rect
              x="-46"
              y="-11"
              width="92"
              height="22"
              rx="11"
              fill="#0b1120"
              stroke="#6366f1"
              strokeWidth="1.2"
            />
            <text
              x="0"
              y="3.5"
              textAnchor="middle"
              fill="#c7d2fe"
              fontSize="9.5"
              fontWeight="bold"
            >
              {item.label.length > 7 ? item.label.slice(0, 6) + '..' : item.label}
            </text>
          </g>
        ))}
      </g>

      {/* 节点卡片（绝对静止不动，仅大图 hover 出气泡） */}
      <g className="nodes">
        {layout.nodesWithPos.map(({ node, x, y, w, h }) => {
          const isEnd =
            node.isEnding ||
            node.type?.includes('end') ||
            node.title?.includes('终') ||
            node.title?.includes('结局');
          const isDecision = (node.choices && node.choices.length > 1) || false;

          const borderCol = isEnd ? '#ef4444' : isDecision ? '#6366f1' : '#475569';
          const fillCol = '#0f172a';
          const badgeBg = isEnd ? '#7f1d1d' : isDecision ? '#312e81' : '#1e293b';
          const badgeText = isEnd ? '终局结局' : isDecision ? '核心抉择' : '剧情节点';
          const badgeColor = isEnd ? '#fca5a5' : isDecision ? '#c7d2fe' : '#94a3b8';

          return (
            <g
              key={node.id}
              transform={`translate(${x}, ${y})`}
              className={isInteractiveModal ? 'cursor-default' : ''}
              onMouseEnter={
                isInteractiveModal
                  ? (e) => {
                      setTooltip({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        title: `${node.title} (#${node.id})`,
                        badge: badgeText,
                        badgeColor: borderCol,
                        content: node.summary || '暂无详细描述',
                        details: [
                          node.estimatedDurationSec ? `时长: ${node.estimatedDurationSec}s` : '',
                          node.choices && node.choices.length > 0
                            ? `包含 ${node.choices.length} 条分支走向`
                            : '多结局归宿点',
                        ].filter(Boolean),
                      });
                    }
                  : undefined
              }
              onMouseMove={
                isInteractiveModal
                  ? (e) => {
                      setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
                    }
                  : undefined
              }
              onMouseLeave={isInteractiveModal ? () => setTooltip(null) : undefined}
            >
              {/* 外圈光晕边框（保持静态，无 hover 放大） */}
              <rect
                x="-1.5"
                y="-1.5"
                width={w + 3}
                height={h + 3}
                rx="12"
                fill="none"
                stroke={borderCol}
                strokeWidth="1"
                strokeOpacity="0.45"
              />

              {/* 卡片主体 */}
              <rect
                x="0"
                y="0"
                width={w}
                height={h}
                rx="11"
                fill={fillCol}
                stroke={borderCol}
                strokeWidth="2"
              />

              {/* 标题 */}
              <text
                x="12"
                y="26"
                fill="#f8fafc"
                fontSize="12.5"
                fontWeight="bold"
              >
                {node.title.length > 10 ? node.title.slice(0, 9) + '...' : node.title}
              </text>

              {/* 状态徽章 Badge */}
              <g transform={`translate(${w - 68}, 12)`}>
                <rect width="58" height="18" rx="9" fill={badgeBg} stroke={borderCol} strokeWidth="1" />
                <text
                  x="29"
                  y="12"
                  textAnchor="middle"
                  fill={badgeColor}
                  fontSize="8.5"
                  fontWeight="bold"
                >
                  {badgeText}
                </text>
              </g>

              {/* 分割线 */}
              <line x1="12" y1="35" x2={w - 12} y2="35" stroke="#334155" strokeWidth="1" />

              {/* 剧情摘要 */}
              <text x="12" y="53" fill="#94a3b8" fontSize="10">
                {(node.summary || '').slice(0, 14)}
              </text>
              <text x="12" y="69" fill="#94a3b8" fontSize="10">
                {(node.summary || '').slice(14, 28)}
                {(node.summary || '').length > 28 ? '...' : ''}
              </text>

              {/* 底部节点 ID */}
              <text x="12" y="93" fill="#64748b" fontSize="9" fontFamily="monospace">
                #{node.id}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );

  return (
    <div className="w-full flex flex-col gap-3 relative">
      {/* 顶部指示条 */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 rounded-xl border border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800 font-bold text-[11px]">
            共 {nodes.length} 个剧情节点
          </span>
          <span className="text-slate-400 text-[11px]">· {choices.length} 条分支走向</span>
        </div>
        <span className="text-[11px] text-slate-500 font-medium">
          点击图表全屏放大 ↗
        </span>
      </div>

      {/* 流程图自适应框：无滚动条，直接缩小自适应显示全貌，点击整图直接全屏放大 */}
      <div
        onClick={() => setIsModalOpen(true)}
        className="w-full h-[360px] rounded-2xl border border-slate-800 bg-slate-950 shadow-xl overflow-hidden relative cursor-zoom-in group p-2 flex items-center justify-center transition-all hover:border-indigo-500/60"
        title="点击放大查看全景图"
      >
        {renderSvgGraph(false)}

        {/* 悬浮提示浮层 */}
        <div className="absolute bottom-3 right-4 px-3 py-1.5 rounded-xl bg-slate-900/95 border border-slate-700/80 text-[11px] text-indigo-300 font-medium pointer-events-none opacity-80 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 shadow-lg backdrop-blur-md">
          <span>全貌缩略预览 · 点击全屏放大 ↗</span>
        </div>
      </div>

      {/* 全屏大图弹窗 Modal（支持鼠标滚轮缩放 + 拖拽平移 + 静止卡片 Hover 气泡） */}
      {isModalOpen && (
        <div
          onClick={() => setIsModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-6xl h-[92vh] bg-slate-950 border border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden relative"
          >
            {/* 弹窗头部工具栏 */}
            <div className="px-6 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 backdrop-blur-md z-10 shrink-0">
              <div className="flex items-center gap-2.5">
                <GitBranch className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">网状互动故事拓扑全景图</h3>
                <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md">
                  共 {nodes.length} 个节点 · {choices.length} 条分支
                </span>
              </div>

              {/* 缩放控制器工具条 */}
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-lg bg-slate-800 border border-slate-700 p-0.5 text-xs text-slate-300">
                  <button
                    onClick={() => setZoomScale((prev) => Math.max(0.4, prev * 0.85))}
                    className="p-1.5 hover:text-white hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                    title="缩小"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="px-2 font-mono text-[11px] font-bold min-w-[48px] text-center">
                    {Math.round(zoomScale * 100)}%
                  </span>
                  <button
                    onClick={() => setZoomScale((prev) => Math.min(3.5, prev * 1.15))}
                    className="p-1.5 hover:text-white hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                    title="放大"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setZoomScale(1.0);
                      setPanOffset({ x: 0, y: 0 });
                    }}
                    className="p-1.5 hover:text-white hover:bg-slate-700 rounded-md transition-colors cursor-pointer border-l border-slate-700"
                    title="复位视角 (100%)"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
                  title="关闭 (Escape)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 弹窗图表画布：支持滚轮缩放与鼠标拖拽平移 */}
            <div
              onWheel={handleModalWheel}
              onMouseDown={handleModalMouseDown}
              onMouseMove={handleModalMouseMove}
              onMouseUp={handleModalMouseUp}
              onMouseLeave={handleModalMouseUp}
              className={`flex-1 w-full h-full overflow-hidden bg-slate-950 relative select-none flex items-center justify-center ${
                isPanning ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            >
              <div
                style={{
                  width: `${layout.width}px`,
                  height: `${layout.height}px`,
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 0.08s ease-out',
                }}
                className="shrink-0"
              >
                {renderSvgGraph(true)}
              </div>

              {/* 弹窗底部操作指南提示 */}
              <div className="absolute bottom-4 left-6 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 pointer-events-none backdrop-blur-md flex items-center gap-2">
                <span>🖱️ 鼠标滚轮缩放</span>
                <span>·</span>
                <span>按住鼠标左键可拖拽平移</span>
                <span>·</span>
                <span>鼠标悬停查看完整剧情</span>
                <span>·</span>
                <span>ESC 键退出</span>
              </div>
            </div>

            {/* 悬停详细内容气泡 Tooltip（仅在大图弹窗内生效） */}
            {tooltip && tooltip.visible && (
              <div
                style={{
                  left: `${Math.min(typeof window !== 'undefined' ? window.innerWidth - 340 : 800, tooltip.x + 14)}px`,
                  top: `${Math.min(typeof window !== 'undefined' ? window.innerHeight - 220 : 600, tooltip.y + 14)}px`,
                }}
                className="fixed pointer-events-none z-[100] w-80 p-3.5 rounded-2xl bg-slate-900/95 border border-indigo-500/60 shadow-2xl backdrop-blur-xl text-slate-200 space-y-2 animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                  <h5 className="font-bold text-xs text-white line-clamp-1">{tooltip.title}</h5>
                  {tooltip.badge && (
                    <span
                      style={{ borderColor: tooltip.badgeColor }}
                      className="text-[9px] px-2 py-0.5 rounded-full border bg-black/50 font-bold text-indigo-300 shrink-0"
                    >
                      {tooltip.badge}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed break-words whitespace-pre-wrap">
                  {tooltip.content}
                </p>
                {tooltip.details && tooltip.details.length > 0 && (
                  <div className="pt-1.5 border-t border-white/10 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                    {tooltip.details.map((d, i) => (
                      <span key={i} className="bg-slate-800/90 px-2 py-0.5 rounded-md border border-slate-700/80">
                        {d}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
