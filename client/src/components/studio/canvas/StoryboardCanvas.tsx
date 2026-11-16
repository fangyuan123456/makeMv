/**
 * client/src/components/studio/canvas/StoryboardCanvas.tsx
 * 视听分镜无限画布工作台 (Storyboard Infinite Canvas SSOT)
 *
 * 核心架构：
 * 1. 类似即梦画布的自由二维空间：支持平移 (Pan)、平滑缩放 (Zoom)、自适应视图 (Fit View)；
 * 2. 节点自由拖拽移动，松手后轻量同步坐标；
 * 3. 动态 SVG 贝塞尔曲线因果连线，中央标注互动抉择选项；
 * 4. 多候选方案实时挂载与局部单镜头独立渲染。
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  StoryboardCanvasData,
  CanvasShotNode,
  CanvasBranchEdge,
  ProjectData,
} from '../../../types/index.js';
import { ShotCanvasCard } from './ShotCanvasCard.js';
import { LookdevRootCanvasCard } from './LookdevRootCanvasCard.js';
import { ShotFocusDrawer } from './ShotFocusDrawer.js';
import {
  fetchStoryboardCanvas,
  saveStoryboardCanvas,
  selectCanvasCandidate,
} from '../../../lib/api.js';

interface StoryboardCanvasProps {
  projectId: string;
  projectData?: ProjectData | null;
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  isBusy: boolean;
}

export const StoryboardCanvas: React.FC<StoryboardCanvasProps> = ({
  projectId,
  projectData,
  onRunTool,
  isBusy,
}) => {
  const [canvasData, setCanvasData] = useState<StoryboardCanvasData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusDrawerNode, setFocusDrawerNode] = useState<CanvasShotNode | null>(null);

  // 视口变换参数
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // 节点拖拽状态
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, nodeX: 0, nodeY: 0 });

  const containerRef = useRef<HTMLDivElement>(null);

  // 1. 加载画布数据
  const loadCanvas = useCallback(async () => {
    if (!projectId) return;
    try {
      setIsLoading(true);
      const data = await fetchStoryboardCanvas(projectId);
      setCanvasData(data);
      if (data.viewport) {
        setZoom(data.viewport.zoom || 1.0);
        setPan({ x: data.viewport.x || 0, y: data.viewport.y || 0 });
      }
    } catch (err) {
      console.error('[StoryboardCanvas] 加载画布失败:', err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadCanvas();
  }, [loadCanvas]);

  // 2. 自动保存画布状态 (节流同步)
  const syncCanvasDebounced = useRef<any>(null);
  const saveCanvasState = (nextData: StoryboardCanvasData) => {
    setCanvasData(nextData);
    if (syncCanvasDebounced.current) clearTimeout(syncCanvasDebounced.current);
    syncCanvasDebounced.current = setTimeout(() => {
      saveStoryboardCanvas(projectId, nextData).catch((err) => {
        console.warn('[StoryboardCanvas] 自动同步坐标失败:', err);
      });
    }, 400);
  };

  // 3. 画布鼠标滚轮缩放
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const newZoom = Math.min(2.0, Math.max(0.25, zoom * zoomFactor));

    // 以鼠标位置为缩放中心
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    }
  };

  // 4. 画布视口平移
  const handleMouseDown = (e: React.MouseEvent) => {
    // 若点击的是卡片或卡片内部按钮，不触发视口拖拽
    if ((e.target as HTMLElement).closest('.cursor-move')) return;

    setIsPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      return;
    }

    if (draggingNodeId && canvasData) {
      const dx = (e.clientX - dragStartRef.current.mouseX) / zoom;
      const dy = (e.clientY - dragStartRef.current.mouseY) / zoom;

      const newX = Math.round(dragStartRef.current.nodeX + dx);
      const newY = Math.round(dragStartRef.current.nodeY + dy);

      const targetNode = canvasData.nodes[draggingNodeId];
      if (targetNode) {
        const nextNodes = {
          ...canvasData.nodes,
          [draggingNodeId]: {
            ...targetNode,
            position: { x: newX, y: newY },
          },
        };
        setCanvasData({ ...canvasData, nodes: nextNodes });
      }
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (draggingNodeId && canvasData) {
      saveCanvasState(canvasData);
      setDraggingNodeId(null);
    }
  };

  // 5. 节点拖拽启动
  const startDragNode = (nodeId: string, e: React.MouseEvent) => {
    if (!canvasData?.nodes[nodeId]) return;
    setDraggingNodeId(nodeId);
    setSelectedNodeId(nodeId);
    const node = canvasData.nodes[nodeId];
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      nodeX: node.position.x,
      nodeY: node.position.y,
    };
  };

  // 6. 切换候选视频
  const handleSelectCandidate = async (nodeId: string, taskId: string) => {
    try {
      await selectCanvasCandidate(projectId, nodeId, taskId);
      const updated = await fetchStoryboardCanvas(projectId);
      setCanvasData(updated);
      if (updated.nodes?.[nodeId]) {
        setFocusDrawerNode(updated.nodes[nodeId]);
      }
    } catch (err) {
      console.error('[StoryboardCanvas] 切换候选失败:', err);
    }
  };

  // 7. 局部渲染单个分镜视频
  const handleRenderSingleVideo = async (node: CanvasShotNode, customPrompt?: string) => {
    await onRunTool('film.shot_video', {
      shotId: node.shotId || node.id,
      clipId: node.clipId,
      customPrompt: customPrompt || node.prompt,
      force: true,
    });
    // 渲染启动后轻量延时刷新画布节点状态
    setTimeout(() => {
      loadCanvas();
    }, 1000);
  };

  // 8. 视口自适应 (Fit View)
  const handleFitView = () => {
    if (!canvasData || Object.keys(canvasData.nodes).length === 0) {
      setZoom(1.0);
      setPan({ x: 80, y: 80 });
      return;
    }

    const nodes = Object.values(canvasData.nodes);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of nodes) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + (n.size?.w || 320));
      maxY = Math.max(maxY, n.position.y + (n.size?.h || 260));
    }

    if (containerRef.current) {
      const padding = 100;
      const width = maxX - minX + padding * 2;
      const height = maxY - minY + padding * 2;
      const cWidth = containerRef.current.clientWidth;
      const cHeight = containerRef.current.clientHeight;

      const fitZoom = Math.min(1.2, Math.max(0.4, Math.min(cWidth / width, cHeight / height)));
      setZoom(fitZoom);
      setPan({
        x: (cWidth - (maxX + minX) * fitZoom) / 2,
        y: (cHeight - (maxY + minY) * fitZoom) / 2,
      });
    }
  };

  // 9. 自动整理整齐排版 (Auto Tidy Layout)
  const handleAutoLayout = () => {
    if (!canvasData) return;
    const nodes = Object.values(canvasData.nodes);
    const nextNodes: Record<string, CanvasShotNode> = {};

    let currentX = 80;
    nodes.forEach((n, idx) => {
      nextNodes[n.id] = {
        ...n,
        position: {
          x: currentX,
          y: 140 + (idx % 2 === 1 ? 80 : 0),
        },
      };
      currentX += (n.size?.w || 320) + 80;
    });

    const nextData = { ...canvasData, nodes: nextNodes };
    saveCanvasState(nextData);
    setTimeout(handleFitView, 50);
  };

  // 10. 计算 SVG 贝塞尔曲线
  const renderEdges = () => {
    if (!canvasData) return null;
    const { nodes, edges } = canvasData;

    return Object.values(edges).map((edge) => {
      const fromNode = nodes[edge.fromNodeId];
      const toNode = nodes[edge.toNodeId];
      if (!fromNode || !toNode) return null;

      const fromW = fromNode.size?.w || 320;
      const fromH = 140; // 连接桩垂直中点
      const toH = 140;

      const x1 = fromNode.position.x + fromW;
      const y1 = fromNode.position.y + fromH;
      const x2 = toNode.position.x;
      const y2 = toNode.position.y + toH;

      const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
      const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      return (
        <g key={edge.id} className="pointer-events-auto">
          {/* 连线光晕底线 */}
          <path
            d={pathD}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth="3"
            strokeDasharray={edge.choiceText ? '4 3' : undefined}
            className="hover:stroke-indigo-400 transition"
          />
          {/* 箭头指向点 */}
          <circle cx={x2} cy={y2} r="4" fill="#6366f1" />

          {/* 分支选择文案浮层 */}
          {edge.choiceText && (
            <foreignObject
              x={midX - 70}
              y={midY - 14}
              width="140"
              height="28"
              className="overflow-visible"
            >
              <div className="flex items-center justify-center">
                <span className="px-2 py-0.5 rounded-full bg-white/95 border border-indigo-200/90 text-indigo-700 text-[10px] font-semibold shadow-xs truncate max-w-[130px] backdrop-blur-xs select-none">
                  {edge.choiceText}
                </span>
              </div>
            </foreignObject>
          )}
        </g>
      );
    });
  };

  if (isLoading && !canvasData) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center space-y-2">
          <span className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
          <span className="text-xs text-slate-500 font-medium">加载视听无限画布中...</span>
        </div>
      </div>
    );
  }

  const nodesList = Object.values(canvasData?.nodes || {});

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="relative w-full h-full bg-slate-100/70 overflow-hidden select-none cursor-grab active:cursor-grabbing"
      style={{
        backgroundImage: `radial-gradient(#cbd5e1 1.2px, transparent 1.2px)`,
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
    >
      {/* 顶部悬浮控制栏 */}
      <div className="absolute top-4 left-6 z-40 bg-white/90 backdrop-blur-md border border-slate-200/90 rounded-2xl p-2 shadow-sm flex items-center space-x-2">
        <div className="flex items-center space-x-1 pr-2 border-r border-slate-200">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 px-2">
            <span>🎨</span>
            <span>视听无限画布</span>
          </span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-semibold">
            {nodesList.length} 镜头节点
          </span>
        </div>

        <button
          onClick={handleFitView}
          className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium border border-slate-200 transition flex items-center gap-1"
          title="适应全屏自适应视图"
        >
          <span>🎯</span>
          <span>全览</span>
        </button>

        <button
          onClick={handleAutoLayout}
          className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium border border-slate-200 transition flex items-center gap-1"
          title="一键整齐排版"
        >
          <span>✨</span>
          <span>自动排版</span>
        </button>

        <button
          onClick={() => onRunTool('film.shot_video', { force: false })}
          disabled={isBusy}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 flex items-center gap-1"
          title="为所有待生成镜头批量渲染视频"
        >
          <span>⚡</span>
          <span>全剧批量渲染</span>
        </button>
      </div>

      {/* 右下角缩放控制器 */}
      <div className="absolute bottom-6 right-6 z-40 bg-white/90 backdrop-blur-md border border-slate-200/90 rounded-xl p-1.5 shadow-sm flex items-center space-x-1 font-mono text-xs text-slate-600">
        <button
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.15))}
          className="w-7 h-7 flex items-center justify-center hover:bg-slate-100 rounded-lg transition"
        >
          -
        </button>
        <span className="px-2 font-semibold select-none">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom((z) => Math.min(2.0, z + 0.15))}
          className="w-7 h-7 flex items-center justify-center hover:bg-slate-100 rounded-lg transition"
        >
          +
        </button>
      </div>

      {/* 主画布缩放平移图层 */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
        }}
      >
        {/* SVG 连线层 */}
        <svg
          className="absolute inset-0 w-[10000px] h-[10000px] overflow-visible pointer-events-none"
          style={{ transform: 'translate(0, 0)' }}
        >
          {renderEdges()}
        </svg>

        {/* 节点卡片层 */}
        <div className="relative w-full h-full pointer-events-auto">
          {nodesList.map((node) => (
            <div
              key={node.id}
              onMouseDown={(e) => {
                e.stopPropagation();
                startDragNode(node.id, e);
              }}
            >
              {node.type === 'lookdev_root' ? (
                <LookdevRootCanvasCard
                  node={node}
                  isSelected={selectedNodeId === node.id}
                  onSelect={() => setSelectedNodeId(node.id)}
                  onOpenDrillDown={(n) => setFocusDrawerNode(n)}
                />
              ) : (
                <ShotCanvasCard
                  node={node}
                  isSelected={selectedNodeId === node.id}
                  onSelect={() => setSelectedNodeId(node.id)}
                  onOpenDrillDown={(n) => setFocusDrawerNode(n)}
                  onRenderVideo={handleRenderSingleVideo}
                  onSelectCandidate={handleSelectCandidate}
                  isBusy={isBusy}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 递进式镜头演播工作舱抽屉 */}
      <ShotFocusDrawer
        node={focusDrawerNode}
        projectId={projectId}
        projectData={projectData}
        onClose={() => setFocusDrawerNode(null)}
        onSelectCandidate={handleSelectCandidate}
        onRenderVideo={handleRenderSingleVideo}
        onRenderKeyframe={async (shotId) => {
          await onRunTool('film.shot_keyframe', { shotId, force: true });
          await loadCanvas();
        }}
        isBusy={isBusy}
      />
    </div>
  );
};
