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

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  StoryboardCanvasData,
  CanvasShotNode,
  CanvasBranchEdge,
  ProjectData,
  TaskRecord,
} from '../../../types/index.js';
import { ShotCanvasCard } from './ShotCanvasCard.js';
import { LookdevRootCanvasCard } from './LookdevRootCanvasCard.js';
import { ShotFocusDrawer } from './ShotFocusDrawer.js';
import { ShotProcessCanvas } from './ShotProcessCanvas.js';
import { ShotScriptCard } from './ShotScriptCard.js';
import { SubCanvasSwitcher, type SubCanvasOption } from './SubCanvasSwitcher.js';
import type { MediaLightboxItem } from '../stages/visual/MediaLightboxModal.js';
import { useReportFocus } from '../../../hooks/StudioFocusContext.js';
import {
  fetchStoryboardCanvas,
  saveStoryboardCanvas,
  selectCanvasCandidate,
  updateShotContinuity,
} from '../../../lib/api.js';

interface StoryboardCanvasProps {
  projectId: string;
  projectData?: ProjectData | null;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
  isBusy: boolean;
  /** When set, show only the shot nodes belonging to this clip. */
  clipId?: string;
  clipTitle?: string;
  onBackToTopology?: () => void;
  onEnlargeMedia?: (media: {
    title: string;
    imageUrl?: string;
    videoUrl?: string;
    badge?: string;
    subtitle?: string;
    gallery?: MediaLightboxItem[];
  }) => void;
  subCanvasOptions?: SubCanvasOption[];
  onSwitchSubCanvas?: (option: SubCanvasOption) => void;
}

function matchesClipId(item: any, targetClipId: string): boolean {
  if (!item) return false;
  if (item.clipId === targetClipId || item.id === targetClipId || item.sourceNodeId === targetClipId) {
    return true;
  }
  if (/^(?:s|scene_)\d+$/i.test(targetClipId)) {
    const legacyId = `c${targetClipId.replace(/\D/g, '')}`;
    return item.clipId === legacyId || item.sourceNodeId === legacyId;
  }
  return false;
}

function resolveClipStoryboard(projectData: ProjectData | null | undefined, clipId?: string): { clip: any; shots: any[] } {
  if (!clipId || !projectData) return { clip: undefined, shots: [] };
  const rawStoryboards = projectData.storyboards || projectData.artifacts?.storyboards || [];
  const filmSpec = projectData.artifacts?.film_spec;
  let clip: any = Array.isArray(rawStoryboards)
    ? rawStoryboards.find((item: any) => matchesClipId(item, clipId))
    : undefined;
  if (!clip && Array.isArray(filmSpec?.clips)) {
    clip = filmSpec.clips.find((item: any) => matchesClipId(item, clipId));
  }
  const shots = Array.isArray(clip?.shots)
    ? clip.shots
    : Array.isArray(rawStoryboards)
    ? rawStoryboards.filter((item: any) => item.clipId === clipId && !Array.isArray(item.shots))
    : [];
  return { clip, shots };
}

/** 从项目快照（storyboards.json / film_spec.clips）里反查镜头的权威资产数据 */
function findProjectShot(projectData: ProjectData | null | undefined, shotId?: string): any | undefined {
  if (!shotId || !projectData) return undefined;
  const sources = [
    projectData.storyboards,
    projectData.artifacts?.storyboards,
    (projectData.artifacts as any)?.film_spec?.clips,
  ];
  for (const clips of sources) {
    if (!Array.isArray(clips)) continue;
    for (const clip of clips) {
      if (!clip) continue;
      if ((clip.shotId || clip.id) === shotId && !Array.isArray(clip.shots)) return clip;
      const shot = Array.isArray(clip.shots)
        ? clip.shots.find((s: any) => (s?.shotId || s?.id) === shotId)
        : undefined;
      if (shot) return shot;
    }
  }
  return undefined;
}

/** 从项目快照中反查镜头对应的导演摄制台本动作节拍 (Shooting Script Action Beat) */
function findActionBeat(
  projectData: ProjectData | null | undefined,
  clipId?: string,
  shotId?: string,
  shotTitle?: string
): any | undefined {
  if (!projectData) return undefined;
  const sources = [
    projectData.storyboards,
    projectData.artifacts?.storyboards,
    (projectData.artifacts as any)?.film_spec?.clips,
  ];

  for (const clips of sources) {
    if (!Array.isArray(clips)) continue;
    for (const clip of clips) {
      if (!clip) continue;
      // 当指定了 clipId 时，严格隔离在当前分幕内，杜绝跨幕数据污染
      if (clipId && !matchesClipId(clip, clipId)) continue;

      const script = clip.shootingScript;
      if (!script || !Array.isArray(script.actionBeats) || script.actionBeats.length === 0) continue;

      const beats: any[] = script.actionBeats;

      // 1. 精确匹配 beatId 或 shotId
      if (shotId) {
        const found = beats.find(
          (b) =>
            b.beatId === shotId ||
            b.shotId === shotId ||
            (b.beatId && shotId && b.beatId.replace(/[-_]/g, '').toLowerCase() === shotId.replace(/[-_]/g, '').toLowerCase())
        );
        if (found) return found;
      }

      // 2. 从 shotTitle 或 shotId 提取镜头序号匹配当前幕内节拍
      const numMatch = (shotTitle || shotId || '').match(/(?:镜头|\bshot[_-]?|[sS]\d+[_-])\s*(\d+)/i);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10);
        const found = beats.find((b) => {
          if (b.shotNumber === idx) return true;
          const bMatch = b.beatTitle?.match(/(?:镜头|\bbeat[_-]?|[sS]\d+[_-])\s*(\d+)/i);
          return bMatch && parseInt(bMatch[1], 10) === idx;
        });
        if (found) return found;

        if (beats[idx - 1]) {
          return beats[idx - 1];
        }
      }

      // 3. 在当前幕下根据 shots 数组索引对齐
      if (Array.isArray(clip.shots) && shotId) {
        const shotIdx = clip.shots.findIndex((s: any) => (s?.shotId || s?.id) === shotId);
        if (shotIdx >= 0 && beats[shotIdx]) {
          return beats[shotIdx];
        }
      }
    }
  }
  return undefined;
}

export const StoryboardCanvas: React.FC<StoryboardCanvasProps> = ({
  projectId,
  projectData,
  tasks = [],
  onRunTool,
  onRefreshProject,
  isBusy,
  clipId,
  clipTitle,
  onBackToTopology,
  onEnlargeMedia,
  subCanvasOptions,
  onSwitchSubCanvas,
}) => {
  const [canvasData, setCanvasData] = useState<StoryboardCanvasData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusDrawerNode, setFocusDrawerNode] = useState<CanvasShotNode | null>(null);
  const [processCanvasNode, setProcessCanvasNode] = useState<CanvasShotNode | null>(null);

  // 切换分幕时自动重置选中与打开的检视抽屉
  useEffect(() => {
    setSelectedNodeId(null);
    setFocusDrawerNode(null);
    setProcessCanvasNode(null);
  }, [clipId]);

  // 视口变换参数
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, mouseX: 0, mouseY: 0 });

  // 节点拖拽状态
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, nodeX: 0, nodeY: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const autoPlanKeyRef = useRef<string | null>(null);

  const { clip: resolvedClip, shots: resolvedClipShots } = useMemo(
    () => resolveClipStoryboard(projectData, clipId),
    [projectData, clipId]
  );

  // 当前幕（或全剧）是否正在执行分镜规划/台本重排
  const activePlanningTask = tasks.find((t) => {
    if (t.status !== 'running' && t.status !== 'pending') return false;
    if (t.toolName !== 'film.shooting_script') return false;
    if (!clipId) return true;
    const targetClipId = t.input?.clipId;
    return !targetClipId || targetClipId === clipId;
  });
  const isPlanningStoryboard = Boolean(activePlanningTask);

  // 首次进入尚未拆解分镜的单幕画布时，自动触发本幕工业级分镜摄制单规划
  useEffect(() => {
    if (!projectId || !clipId || !projectData) return;
    const key = `${projectId}:${clipId}`;
    if (resolvedClipShots.length > 0 || isPlanningStoryboard || autoPlanKeyRef.current === key) return;
    autoPlanKeyRef.current = key;
    console.log(`[StoryboardCanvas] 首次进入分幕 [${clipId}]，自动规划本幕工业级分镜摄制台本...`);
    onRunTool('film.shooting_script', {
      clipId,
      __idempotencyKey: `storyboard:auto-plan:${projectId}:${clipId}`,
    })
      .then(() => onRefreshProject?.())
      .catch((err) => console.warn(`[StoryboardCanvas] 自动规划分幕 [${clipId}] 分镜失败:`, err));
  }, [projectId, clipId, projectData, resolvedClipShots.length, isPlanningStoryboard, onRunTool, onRefreshProject]);

  const scopeCanvasToClip = useCallback((data: StoryboardCanvasData): StoryboardCanvasData => {
    if (!clipId) return data;

    const clip = resolvedClip;
    const shots = resolvedClipShots;
    const existingClipNode = Object.values(data.nodes).find((node) => node.clipId === clipId);
    const nodes: Record<string, CanvasShotNode> = {};
    const scriptBeats: any[] = clip?.shootingScript?.actionBeats || [];

    shots.forEach((shot: any, index: number) => {
      const shotId = shot.shotId || shot.id || `shot_${clipId}_${index + 1}`;
      const nodeId = `node_${shotId}`;
      const previousShot = index > 0 ? shots[index - 1] : null;
      const previousReady = Boolean(previousShot?.videoUrl || previousShot?.firstFrameImageUrl || previousShot?.keyframeUrl || previousShot?.imageUrl);

      // 精确匹配当前分幕下的摄制台本节拍 (Action Beat)
      const matchedBeat = scriptBeats.find((b: any) =>
        b.beatId === shotId ||
        b.shotNumber === (index + 1) ||
        (b.beatId && shotId && b.beatId.replace(/[-_]/g, '').toLowerCase() === shotId.replace(/[-_]/g, '').toLowerCase())
      ) || scriptBeats[index];

      nodes[nodeId] = {
        id: nodeId,
        type: 'shot_node',
        shotId,
        clipId,
        title: shot.title || shot.name || matchedBeat?.beatTitle || `镜头 ${String(index + 1).padStart(2, '0')}`,
        // 摄制台本视听要素真实直通绑定 (零硬编码)
        actionDescription: matchedBeat?.actionDescription || shot.actionDescription || shot.sceneSubject,
        cinematicIntent: matchedBeat?.cinematicIntent || shot.cinematicIntent || shot.cameraDirective?.instruction,
        dialogue: matchedBeat?.dialogue !== undefined ? matchedBeat.dialogue : shot.dialogue,
        audioAmbience: matchedBeat?.audioAmbience || shot.audioAmbience || shot.audioPrompt,
        shotType: matchedBeat?.shotType || shot.shotType || shot.cameraDirective?.label,
        cameraMovement: matchedBeat?.cameraMovement || shot.cameraMovement,
        // 台本描述的是镜头如何演绎，首帧提示词留给下一级关键帧处理。
        prompt: matchedBeat?.actionDescription || shot.videoPrompt || shot.description || shot.promptZh || shot.visualPromptZh || '',
        durationSec: shot.durationSec || matchedBeat?.estimatedSeconds || shot.duration || 4,
        position: { x: 80 + (index % 3) * 420, y: 120 + Math.floor(index / 3) * 350 },
        size: { w: 260, h: 280 },
        videoUrl: shot.videoUrl || clip?.videoUrl || undefined,
        keyframeUrl: shot.firstFrameImageUrl || shot.keyframeUrl || shot.imageUrl || undefined,
        lastFrameUrl: shot.lastFrameImageUrl || shot.lastFrameUrl || undefined,
        firstFrameUpscale: shot.firstFrameUpscale,
        lastFrameUpscale: shot.lastFrameUpscale,
        firstFrameVersions: shot.firstFrameVersions,
        lastFrameVersions: shot.lastFrameVersions,
        generationMode: shot.generationMode,
        firstFramePrompt: shot.firstFramePrompt || shot.keyframePrompt || '',
        lastFramePrompt: shot.lastFramePrompt || '',
        videoPrompt: shot.videoPrompt || shot.description || shot.promptZh || '',
        sceneSubject: shot.sceneSubject,
        sliceSummary: shot.sliceSummary,
        weatherDirective: shot.weatherDirective,
        cameraDirective: shot.cameraDirective,
        colorDirective: shot.colorDirective,
        poseDirective: shot.poseDirective,
        motionDirective: shot.motionDirective,
        dynamicDirective: shot.dynamicDirective,
        focusDirective: shot.focusDirective,
        continuityMode: shot.continuityMode || 'auto',
        isUnlocked: index === 0 || previousReady,
      };
    });

    // Older projects may only have a clip-level canvas node. Keep it visible rather than showing an empty canvas.
    if (Object.keys(nodes).length === 0 && existingClipNode) {
      nodes[existingClipNode.id] = { ...existingClipNode, position: { x: 80, y: 120 }, isUnlocked: true };
    }

    const nodeIds = Object.keys(nodes);
    const edges: Record<string, CanvasBranchEdge> = {};
    nodeIds.slice(1).forEach((nodeId, index) => {
      edges[`edge_${nodeIds[index]}_${nodeId}`] = {
        id: `edge_${nodeIds[index]}_${nodeId}`,
        fromNodeId: nodeIds[index],
        toNodeId: nodeId,
      };
    });

    return {
      ...data,
      viewport: { x: 0, y: 0, zoom: 0.8 },
      nodes,
      edges,
    };
  }, [clipId, resolvedClip, resolvedClipShots]);

  // 1. 加载画布数据
  const loadCanvas = useCallback(async () => {
    if (!projectId) return;
    try {
      setIsLoading(true);
      const data = await fetchStoryboardCanvas(projectId);
      setCanvasData(scopeCanvasToClip(data));
      if (data.viewport) {
        setZoom(data.viewport.zoom || 1.0);
        setPan({ x: data.viewport.x || 0, y: data.viewport.y || 0 });
      }
    } catch (err) {
      console.error('[StoryboardCanvas] 加载画布失败:', err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, scopeCanvasToClip]);

  useEffect(() => {
    loadCanvas();
  }, [loadCanvas]);

  // 镜头资产（版本切换 / 提示词保存 / 微调出图）改动后，同时刷新项目快照与画布节点
  const refreshShotAssets = useCallback(() => {
    onRefreshProject?.();
    loadCanvas();
  }, [onRefreshProject, loadCanvas]);

  // 2. 自动保存画布状态 (节流同步)
  const syncCanvasDebounced = useRef<any>(null);
  const saveCanvasState = (nextData: StoryboardCanvasData) => {
    setCanvasData(nextData);
    if (clipId) return;
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

  // 4. 画布视口平移（纯点击画布空白处松手时取消当前镜头选中）
  const handleMouseDown = (e: React.MouseEvent) => {
    // 若点击的是卡片或按钮，不触发视口拖拽
    if ((e.target as HTMLElement).closest('.cursor-move, button')) return;

    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
      mouseX: e.clientX,
      mouseY: e.clientY,
    };
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

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isPanning) {
      const moved = Math.hypot(
        e.clientX - panStartRef.current.mouseX,
        e.clientY - panStartRef.current.mouseY
      );
      if (moved < 5) {
        setSelectedNodeId(null);
      }
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
    if (canvasData.nodes[nodeId].isUnlocked === false) return;
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
      const updated = scopeCanvasToClip(await fetchStoryboardCanvas(projectId));
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
      customPrompt: customPrompt || node.videoPrompt || node.prompt,
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

  // 切换镜头间前序尾帧视听连续性模式（auto 智能决策 ➔ linked 强制连贯 ➔ detached 独立机位）
  const handleToggleContinuity = async (targetNode: CanvasShotNode) => {
    if (!targetNode.shotId) return;
    const currentMode = targetNode.continuityMode || 'auto';
    const nextMode: 'auto' | 'linked' | 'detached' =
      currentMode === 'auto' ? 'linked' : currentMode === 'linked' ? 'detached' : 'auto';

    // 乐观即时更新画布状态
    setCanvasData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [targetNode.id]: {
            ...prev.nodes[targetNode.id],
            continuityMode: nextMode,
          },
        },
      };
    });

    try {
      await updateShotContinuity(projectId, targetNode.shotId, nextMode);
      onRefreshProject?.();
    } catch (err: any) {
      console.warn('更新镜头连续性失败:', err);
    }
  };

  // 10. 计算 SVG 贝塞尔曲线与镜头连续性控制胶囊
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

      // 判断是否为同幕分镜镜头间的视听连续性连线
      const isShotToShotEdge =
        fromNode.type !== 'lookdev_root' &&
        toNode.type !== 'lookdev_root' &&
        Boolean(toNode.shotId);

      const continuityMode = (toNode.continuityMode || 'auto') as 'auto' | 'linked' | 'detached';

      // 连线样式跟随连续性模式联动
      const strokeColor =
        continuityMode === 'linked'
          ? '#10b981' // 翠绿实线：强制连贯
          : continuityMode === 'detached'
          ? '#94a3b8' // 浅灰虚线：独立机位
          : '#6366f1'; // 蓝紫实线：智能决策

      const strokeDash =
        continuityMode === 'detached'
          ? '5 4'
          : edge.choiceText
          ? '4 3'
          : undefined;

      const strokeWidth = continuityMode === 'linked' ? '3.5' : '3';

      return (
        <g key={edge.id} className="pointer-events-auto">
          {/* 连线高保真底线 */}
          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDash}
            className="transition-all hover:opacity-80"
          />
          {/* 箭头指向点 */}
          <circle cx={x2} cy={y2} r="4" fill={strokeColor} />

          {/* 分支选择文案浮层（分支剧情专有） */}
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

          {/* 镜头间连续性三态控制开关胶囊（单幕镜头连线专属） */}
          {isShotToShotEdge && !edge.choiceText && (
            <foreignObject
              x={midX - 52}
              y={midY - 13}
              width="104"
              height="26"
              className="overflow-visible"
            >
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleContinuity(toNode);
                  }}
                  className={`group px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-tight shadow-xs backdrop-blur-md transition-all cursor-pointer flex items-center gap-1 select-none border ${
                    continuityMode === 'linked'
                      ? 'bg-emerald-500/95 text-white border-emerald-300 ring-1 ring-emerald-400/40 hover:bg-emerald-600'
                      : continuityMode === 'detached'
                      ? 'bg-slate-200/90 text-slate-600 border-slate-300/80 hover:bg-slate-300'
                      : 'bg-indigo-600/90 text-white border-indigo-400/60 ring-1 ring-indigo-400/30 hover:bg-indigo-700'
                  }`}
                  title={
                    continuityMode === 'linked'
                      ? '【强制连贯】已锁定承接上一镜头尾帧光影与动作；点击切换为独立机位'
                      : continuityMode === 'detached'
                      ? '【独立机位】已断开上镜尾帧关联；点击切换为 AI 智能决策'
                      : '【AI 智能决策】同场景自动承接上一镜尾帧光影与动作；点击切换为强制连贯'
                  }
                >
                  <span>
                    {continuityMode === 'linked'
                      ? '🔗 继承尾帧'
                      : continuityMode === 'detached'
                      ? '✂️ 独立机位'
                      : '🤖 智能连续'}
                  </span>
                </button>
              </div>
            </foreignObject>
          )}
        </g>
      );
    });
  };

  const withCacheVersion = (url?: string, version?: number): string | undefined => {
    if (!url || !version) return url;
    return `${url}${url.includes('?') ? '&' : '?'}v=${version}`;
  };

  const decoratedNodesMap = useMemo(() => {
    const rawNodes = canvasData?.nodes || {};
    const result: Record<string, CanvasShotNode> = {};
    for (const [id, node] of Object.entries(rawNodes)) {
      const sid = node.shotId;
      // 项目快照里的镜头资产（含版本库）是权威数据源，优先于画布节点的静态副本
      const projectShot = findProjectShot(projectData, sid);
      const actionBeat = findActionBeat(projectData, node.clipId || clipId, sid || node.id, node.title);
      const latestFirstFrameTask = sid
        ? tasks.find(
            (t) =>
              t.status === 'completed' &&
              ((t.toolName === 'film.shot_keyframe' &&
                t.input?.shotId === sid &&
                (!t.input?.frame || t.input.frame === 'first')) ||
                (t.toolName === 'film.image_upscale' &&
                  t.input?.targetKind === 'shot_keyframe' &&
                  t.input?.targetId === sid &&
                  (!t.input?.frame || t.input.frame === 'first')))
          )
        : undefined;
      const latestLastFrameTask = sid
        ? tasks.find(
            (t) =>
              t.status === 'completed' &&
              ((t.toolName === 'film.shot_keyframe' &&
                t.input?.shotId === sid &&
                (!t.input?.frame || t.input.frame === 'last')) ||
                (t.toolName === 'film.image_upscale' &&
                  t.input?.targetKind === 'shot_keyframe' &&
                  t.input?.targetId === sid &&
                  t.input?.frame === 'last'))
          )
        : undefined;
      const latestVideoTask = sid
        ? tasks.find(
            (t) =>
              t.status === 'completed' &&
              t.toolName === 'film.shot_video' &&
              t.input?.shotId === sid
          )
        : undefined;
      const firstVer = latestFirstFrameTask?.completedAt || latestFirstFrameTask?.createdAt;
      const lastVer = latestLastFrameTask?.completedAt || latestLastFrameTask?.createdAt;
      const vidVer = latestVideoTask?.completedAt || latestVideoTask?.createdAt;
      const rawKf =
        projectShot?.firstFrameImageUrl ||
        projectShot?.keyframeUrl ||
        node.keyframeUrl ||
        latestFirstFrameTask?.output?.firstFrameImageUrl ||
        latestFirstFrameTask?.output?.mediaUrl;
      const rawLast =
        projectShot?.lastFrameImageUrl ||
        projectShot?.lastFrameUrl ||
        node.lastFrameUrl ||
        latestLastFrameTask?.output?.lastFrameImageUrl ||
        (latestLastFrameTask?.toolName === 'film.image_upscale'
          ? latestLastFrameTask?.output?.mediaUrl
          : undefined);
      const rawVid = projectShot?.videoUrl || node.videoUrl || latestVideoTask?.output?.videoUrl;
      const firstFrameUpscale = projectShot
        ? projectShot.firstFrameUpscale
        : latestFirstFrameTask?.toolName === 'film.image_upscale'
          ? {
              multiplier: Number(latestFirstFrameTask.output?.multiplier || latestFirstFrameTask.input?.multiplier || 2),
              upscaledAt: new Date(firstVer || Date.now()).toISOString(),
            }
          : latestFirstFrameTask?.toolName === 'film.shot_keyframe'
          ? undefined
          : node.firstFrameUpscale;
      const lastFrameUpscale = projectShot
        ? projectShot.lastFrameUpscale
        : latestLastFrameTask?.toolName === 'film.image_upscale'
          ? {
              multiplier: Number(latestLastFrameTask.output?.multiplier || latestLastFrameTask.input?.multiplier || 2),
              upscaledAt: new Date(lastVer || Date.now()).toISOString(),
            }
          : latestLastFrameTask?.toolName === 'film.shot_keyframe'
          ? undefined
          : node.lastFrameUpscale;
      const staleMap = projectData?.staleMap || projectData?.artifacts?.staleMap;
      const projectVersionStamp = (versions?: { createdAt?: string }[]): number => {
        const last = versions?.[versions.length - 1]?.createdAt;
        return last ? Date.parse(last) || 0 : 0;
      };
      const firstVersions: any[] = projectShot?.firstFrameVersions || node.firstFrameVersions || [];
      const lastVersions: any[] = projectShot?.lastFrameVersions || node.lastFrameVersions || [];
      result[id] = {
        ...node,
        ...(projectShot
          ? {
              firstFramePrompt: projectShot.firstFramePrompt || node.firstFramePrompt,
              lastFramePrompt: projectShot.lastFramePrompt || node.lastFramePrompt,
              videoPrompt: projectShot.videoPrompt || node.videoPrompt,
              sceneSubject: projectShot.sceneSubject || node.sceneSubject,
              sliceSummary: projectShot.sliceSummary || node.sliceSummary,
              weatherDirective: projectShot.weatherDirective || node.weatherDirective,
              cameraDirective: projectShot.cameraDirective || node.cameraDirective,
              colorDirective: projectShot.colorDirective || node.colorDirective,
              poseDirective: projectShot.poseDirective || node.poseDirective,
              motionDirective: projectShot.motionDirective || node.motionDirective,
              dynamicDirective: projectShot.dynamicDirective || node.dynamicDirective,
              focusDirective: projectShot.focusDirective || node.focusDirective,
              continuityMode: projectShot.continuityMode || node.continuityMode || 'auto',
            }
          : {}),
        continuityMode: projectShot?.continuityMode || node.continuityMode || 'auto',
        // 摄制台本视听要素注入
        prompt: actionBeat?.actionDescription || projectShot?.sceneSubject || node.prompt,
        actionDescription:
          actionBeat?.actionDescription ||
          projectShot?.actionDescription ||
          projectShot?.sceneSubject ||
          node.actionDescription,
        cinematicIntent:
          actionBeat?.cinematicIntent ||
          projectShot?.cinematicIntent ||
          (projectShot?.cameraMovement ? `${projectShot?.shotType || ''} · ${projectShot?.cameraMovement}`.trim() : undefined) ||
          node.cinematicIntent,
        dialogue:
          actionBeat?.dialogue !== undefined
            ? actionBeat.dialogue
            : projectShot?.dialogue !== undefined
            ? projectShot.dialogue
            : node.dialogue,
        audioAmbience:
          actionBeat?.audioAmbience ||
          projectShot?.audioAmbience ||
          projectShot?.audioPrompt ||
          projectShot?.ambience ||
          node.audioAmbience,
        shotType: actionBeat?.shotType || projectShot?.shotType || node.shotType,
        cameraMovement: actionBeat?.cameraMovement || projectShot?.cameraMovement || node.cameraMovement,
        firstFrameVersions: firstVersions,
        lastFrameVersions: lastVersions,
        keyframeUrl: withCacheVersion(rawKf, Math.max(firstVer || 0, projectVersionStamp(firstVersions))),
        lastFrameUrl: withCacheVersion(rawLast, Math.max(lastVer || 0, projectVersionStamp(lastVersions))),
        firstFrameUpscale,
        lastFrameUpscale,
        videoUrl: withCacheVersion(rawVid, vidVer),
        staleKeyframeReason: sid ? staleMap?.shotKeyframes?.[sid]?.reason : undefined,
        staleVideoReason: sid ? staleMap?.shotVideos?.[sid]?.reason : undefined,
      };
    }
    return result;
  }, [
    canvasData?.nodes,
    tasks,
    projectData?.staleMap,
    projectData?.artifacts?.staleMap,
    projectData?.storyboards,
    projectData?.artifacts?.storyboards,
  ]);

  const nodesList = Object.values(decoratedNodesMap);
  const selectedCanvasNode = selectedNodeId ? decoratedNodesMap[selectedNodeId] : null;
  const activeProcessNode = processCanvasNode
    ? decoratedNodesMap[processCanvasNode.id] || processCanvasNode
    : null;

  // 上报分镜画布自身焦点（必须位于所有条件 return 之前，严格遵守 React Hooks 顺序；下钻 ShotProcessCanvas 时子页自动压栈覆盖）
  const canvasFocus = useMemo(
    () => ({
      location: clipTitle ? `分镜画布 · ${clipTitle}` : '分镜画布',
      target: selectedCanvasNode
        ? {
            kind: 'shot',
            id: selectedCanvasNode.shotId || selectedCanvasNode.id,
            label: selectedCanvasNode.title,
          }
        : undefined,
      meta: clipId ? { clipId } : undefined,
    }),
    [clipId, clipTitle, selectedCanvasNode]
  );
  useReportFocus(canvasFocus);

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

  if (activeProcessNode) {
    return (
      <ShotProcessCanvas
        node={activeProcessNode}
        allNodes={nodesList}
        onSelectNode={(targetNode) => {
          setProcessCanvasNode(targetNode);
          setSelectedNodeId(targetNode.id);
        }}
        projectId={projectId}
        projectData={projectData}
        tasks={tasks}
        onClose={() => {
          setProcessCanvasNode(null);
          setSelectedNodeId(null);
        }}
        onRunTool={onRunTool}
        onRefreshProject={refreshShotAssets}
        onEnlargeMedia={onEnlargeMedia}
        subCanvasOptions={subCanvasOptions}
        onSwitchSubCanvas={(option) => {
          setProcessCanvasNode(null);
          setSelectedNodeId(null);
          onSwitchSubCanvas?.(option);
        }}
        isBusy={isBusy}
      />
    );
  }

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
      {/* 1. 主画布缩放平移图层 (底层视窗，zIndex: 0，确保绝对位于所有悬浮栏与下拉菜单之下) */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
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
                  isExtractingPrompt={tasks.some(
                    (t) =>
                      (t.status === 'running' || t.status === 'pending') &&
                      t.toolName === 'film.shot_prompt' &&
                      t.input?.shotId === node.shotId
                  )}
                  onSelect={() => setSelectedNodeId(node.id)}
                  onOpenDrillDown={(n) => setProcessCanvasNode(n)}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 2. 顶部悬浮控制栏 (上层 UI，z-20) */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute top-4 left-6 z-20 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl p-2 shadow-sm flex items-center space-x-2"
      >
        {subCanvasOptions && onSwitchSubCanvas ? (
          <SubCanvasSwitcher
            currentId={clipId || ''}
            options={subCanvasOptions}
            onSelect={onSwitchSubCanvas}
            onBackToTopology={onBackToTopology || (() => {})}
            showStepButtons={true}
          />
        ) : (
          <>
            {onBackToTopology && (
              <button
                onClick={onBackToTopology}
                className="px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium border border-slate-200 transition"
              >
                ← 返回流向拓扑
              </button>
            )}
            <div className="flex items-center space-x-1 pr-2 border-r border-slate-200">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 px-2">
                <span>🎬</span>
                <span>{clipTitle || '视听无限画布'}</span>
              </span>
            </div>
          </>
        )}
        <div className="flex items-center space-x-1 pr-2 border-r border-slate-200">
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

        {!clipId && (
          <button
            onClick={() => onRunTool('film.shot_video', { force: false })}
            disabled={isBusy}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 flex items-center gap-1"
            title="为所有待生成镜头批量渲染视频"
          >
            <span>⚡</span>
            <span>全剧批量渲染</span>
          </button>
        )}
      </div>

      {/* 分镜规划推演遮罩固定在画布层，样式与定妆提取遮罩保持一致 */}
      {isPlanningStoryboard && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          className="absolute inset-0 bg-white/85 backdrop-blur-md z-[60] flex flex-col items-center justify-center p-8 select-none cursor-default animate-in fade-in duration-300"
        >
          <div className="relative w-16 h-16 mb-5 flex items-center justify-center">
            <svg
              className="w-14 h-14 text-indigo-600 animate-spin"
              viewBox="0 0 100 100"
              style={{ animationDuration: '1s' }}
            >
              {Array.from({ length: 12 }).map((_, i) => (
                <rect
                  key={i}
                  x="46.5"
                  y="10"
                  width="7"
                  height="22"
                  rx="3.5"
                  fill="currentColor"
                  opacity={(i + 1) / 12}
                  transform={`rotate(${i * 30} 50 50)`}
                />
              ))}
            </svg>
          </div>
          <h3 className="text-base font-black text-slate-800 tracking-tight mb-2">
            {activePlanningTask?.input?.shotId
              ? `AI 分镜执行导演正在重新校准【镜头 ${activePlanningTask.input.shotId}】提示词与视听语法...`
              : `AI 分镜执行导演正在推演${clipTitle ? `【${clipTitle}】` : '本幕'}分镜台本...`}
          </h3>
          <p className="text-xs text-slate-500 text-center max-w-md leading-relaxed mb-5">
            {activePlanningTask?.input?.shotId
              ? '正在按照影视摄影五层公理体系与二元正交动量规范，定向重构首帧生图词与运镜动态表演。'
              : '正在结合本幕剧情文本与视觉定妆资产，逐镜编排景别构图、机位运镜、视听节拍与首帧/动态提示词。'}
          </p>
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-indigo-50 border border-indigo-200/80 text-indigo-700 text-[11px] font-semibold shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
            <span>
              {activePlanningTask?.progress?.message || '🎬 正在拆解镜头节拍 · 🎥 编排景别运镜与提示词'}
            </span>
          </div>
        </div>
      )}

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

      {/* 单击节点后的轻量检视栏；生成操作留在双击进入的下一级。 */}
      {selectedCanvasNode && (
        <aside
          className="absolute top-4 right-4 bottom-4 z-40 w-[420px] max-w-[calc(100vw-2rem)] bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-3xl shadow-xl flex flex-col overflow-hidden overscroll-contain animate-in slide-in-from-right-4 duration-200 select-none"
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <span className="text-lg">🎬</span>
              <div className="truncate">
                <h3 className="text-sm font-bold text-slate-800 truncate">{selectedCanvasNode.title}</h3>
                <span className="text-[11px] text-slate-500 font-medium">镜头节点 · 属性检视</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedNodeId(null)}
              className="w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="关闭检视栏"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-5 text-slate-700">
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-200 group">
              {selectedCanvasNode.videoUrl ? (
                <video src={selectedCanvasNode.videoUrl} controls muted playsInline className="w-full h-full object-cover" />
              ) : selectedCanvasNode.keyframeUrl ? (
                <img src={selectedCanvasNode.keyframeUrl} alt={selectedCanvasNode.title} className="w-full h-full object-cover" />
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">暂无视觉资产</div>
              )}
              {(selectedCanvasNode.videoUrl || selectedCanvasNode.keyframeUrl) && onEnlargeMedia && (
                <button
                  type="button"
                  onClick={() => {
                    const gallery: MediaLightboxItem[] = nodesList
                      .filter((n) => Boolean(n.videoUrl || n.keyframeUrl))
                      .map((n) => ({
                        title: `${n.title} · ${n.videoUrl ? '视频' : '首帧'}`,
                        imageUrl: n.videoUrl ? undefined : n.keyframeUrl,
                        videoUrl: n.videoUrl || undefined,
                      }));
                    onEnlargeMedia({
                      title: `${selectedCanvasNode.title} · ${selectedCanvasNode.videoUrl ? '视频' : '首帧'}`,
                      imageUrl: selectedCanvasNode.videoUrl ? undefined : selectedCanvasNode.keyframeUrl,
                      videoUrl: selectedCanvasNode.videoUrl || undefined,
                      gallery: gallery.length > 0 ? gallery : undefined,
                    });
                  }}
                  className="absolute top-2.5 right-2.5 px-2 py-1 rounded-lg bg-black/65 hover:bg-black/85 backdrop-blur-xs text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
                  title="全屏放大查看"
                >
                  ⛶
                </button>
              )}
            </div>
            {/* 视听资产状态条 */}
            <div className="flex items-center justify-between text-xs px-1">
              <span
                className={`inline-flex items-center gap-1.5 font-medium ${
                  selectedCanvasNode.videoUrl
                    ? 'text-emerald-600'
                    : selectedCanvasNode.keyframeUrl
                    ? 'text-indigo-600'
                    : 'text-slate-400'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    selectedCanvasNode.videoUrl
                      ? 'bg-emerald-500 ring-2 ring-emerald-200'
                      : selectedCanvasNode.keyframeUrl
                      ? 'bg-indigo-500 ring-2 ring-indigo-200'
                      : 'bg-slate-300'
                  }`}
                />
                {selectedCanvasNode.videoUrl
                  ? '动态视频已生成'
                  : selectedCanvasNode.keyframeUrl
                  ? '首帧关键帧已就绪'
                  : '视觉资产待生成'}
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {selectedCanvasNode.continuityMode === 'linked'
                  ? '强制接戏尾帧'
                  : selectedCanvasNode.continuityMode === 'detached'
                  ? '独立自由机位'
                  : '智能时空连续性'}
              </span>
            </div>

            {/* 工业级视听摄制台本卡片 (结构化四维要素，支持直接打字修改并与全剧摄制单 SSOT 联动) */}
            <ShotScriptCard
              node={selectedCanvasNode}
              projectId={projectId}
              clipId={clipId}
              projectData={projectData}
              onRefreshProject={onRefreshProject}
              onNodeUpdate={(updatedNode) => {
                setCanvasData((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    nodes: {
                      ...prev.nodes,
                      [updatedNode.id]: updatedNode,
                    },
                  };
                });
              }}
            />
            <button
              type="button"
              onClick={() => setProcessCanvasNode(selectedCanvasNode)}
              className="w-full px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition flex items-center justify-center gap-1.5"
            >
              <span>进入镜头处理</span>
              <span>→</span>
            </button>
          </div>
        </aside>
      )}

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
