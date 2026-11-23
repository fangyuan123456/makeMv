/**
 * client/src/components/studio/stages/visual/VisualPipelineTopology.tsx
 * 工序 2：电影制作流向拓扑图组件 (Visual Pipeline Topology SSOT - 优雅现代浅色系)
 *
 * 核心机制：
 * 1. 100% 优雅浅色底网格 (#f8fafc + #cbd5e1 点阵)，保持全站一致；
 * 2. 定妆节点：多张微倾斜相纸叠层（Polaroid Photo Stack: -7°, +7°, 0°），去除姓名文字，图片按 xMidYMin meet 完整展示角色头部与全身；
 * 3. 剧情节点全图状态化（彻底消灭小角标，整图视效表达）：
 *    - 未解锁态：整图沉浸式暗黑磨砂 + 居中浮雕金属锁具压印；
 *    - 生成中态：整图全画幅电影扫描线扫光 + 动态脉冲流光；
 *    - 待规划态：整图电影打板器与微光呼吸引导；
 *    - 已就绪态 (正常)：16:9 纯净满屏首帧大图，没有任何控件遮挡；
 *    - 已就绪态 (Hover)：自动循环播放视频切片、浮现顶栏标题与底栏控制条、右下角「放大查看」按钮；
 * 4. 树形因果分叉排版：主干居中，分支横向对称展开（A 在左、B 在右），汇聚连贯；
 * 5. 点击节点直接触发滑出右侧侧边栏工作台 (Sidebar Drawer)，主画布常驻无跨页跳转。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { UniversalPrdSpec, ProjectData, TaskRecord } from '../../../../types/index.js';

export interface VisualPipelineTopologyProps {
  projectData: ProjectData | null;
  tasks?: TaskRecord[];
  selectedNodeId?: string | null;
  onSelectNode?: (node: TopoNode) => void;
  onEnterSubCanvas?: (kind: 'lookdev' | 'clip', clipId?: string, clipTitle?: string) => void;
  onEnlargeClip?: (media: {
    title: string;
    imageUrl?: string;
    videoUrl?: string;
    gallery?: Array<{
      title: string;
      imageUrl?: string;
      videoUrl?: string;
      badge?: string;
      subtitle?: string;
    }>;
  }) => void;
}

export interface TopoNode {
  id: string;
  kind: 'lookdev' | 'clip' | 'ending';
  clipId?: string;
  title: string;
  badge: string;
  badgeColor: string;
  status: 'locked' | 'pending' | 'in_progress' | 'completed';
  isUnlocked: boolean;
  keyframeUrl?: string;
  videoUrl?: string;
  videoUrls?: string[];
  totalShots?: number;
  completedVideos?: number;
  durationSec?: number;
  staleReason?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TopoEdge {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  isUnlocked: boolean;
  path: string;
  lx: number;
  ly: number;
}

interface SequentialClipVideoPlayerProps {
  videoUrls: string[];
  width: number;
  height: number;
}

const SequentialClipVideoPlayer: React.FC<SequentialClipVideoPlayerProps> = ({
  videoUrls,
  width,
  height,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const safeIndex = currentIndex < videoUrls.length ? currentIndex : 0;
  const currentSrc = videoUrls[safeIndex];

  const handleEnded = () => {
    setCurrentIndex((prev) => (prev + 1) % videoUrls.length);
  };

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  }, [safeIndex, currentSrc]);

  return (
    <foreignObject x="0" y="0" width={width} height={height}>
      <div className="relative w-full h-full bg-black overflow-hidden select-none">
        <video
          ref={videoRef}
          key={currentSrc}
          src={currentSrc}
          autoPlay
          muted
          playsInline
          onEnded={handleEnded}
          className="w-full h-full object-cover"
        />
        {/* 多分镜顺序联合播放指示角标 */}
        {videoUrls.length > 1 && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-xs text-[9px] font-mono text-white flex items-center gap-1 shadow-2xs border border-white/20 z-20 pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              分镜 {safeIndex + 1}/{videoUrls.length}
            </span>
          </div>
        )}
      </div>
    </foreignObject>
  );
};

export const VisualPipelineTopology: React.FC<VisualPipelineTopologyProps> = ({
  projectData,
  tasks = [],
  selectedNodeId,
  onSelectNode,
  onEnterSubCanvas,
  onEnlargeClip,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // 画布缩放与平移视口
  const [viewport, setViewport] = useState({ x: 60, y: 30, zoom: 0.88 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lockedToast, setLockedToast] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const prd: UniversalPrdSpec | undefined = projectData?.prd || projectData?.artifacts?.gdd?.prd;
  const entities = projectData?.entities || projectData?.artifacts?.lookdev_entities;
  const characters = entities?.characters || [];
  const locations = entities?.locations || [];
  const items = entities?.items || [];

  // 获取分镜规划数据 (兼容 storyboards 与 film_spec.clips)
  const storyboards = projectData?.storyboards || projectData?.artifacts?.storyboards || [];
  const filmSpec = projectData?.artifacts?.film_spec;
  const staleMap = projectData?.staleMap || projectData?.artifacts?.staleMap;

  const getClipStaleReason = (clipId: string): string | undefined => {
    if (!staleMap) return undefined;
    if (staleMap.clips?.[clipId]?.reason) return staleMap.clips[clipId].reason;
    const clipData =
      storyboards.find((s: any) => s.clipId === clipId || s.sourceNodeId === clipId) ||
      filmSpec?.clips?.find((c: any) => c.clipId === clipId || c.sourceNodeId === clipId);
    const shots: any[] = Array.isArray(clipData?.shots) ? clipData.shots : [];
    const staleKfCount = shots.filter((s) => Boolean(staleMap.shotKeyframes?.[s.shotId || s.id])).length;
    const staleVidCount = shots.filter((s) => Boolean(staleMap.shotVideos?.[s.shotId || s.id])).length;
    if (staleKfCount > 0 || staleVidCount > 0) {
      const parts: string[] = [];
      if (staleKfCount > 0) parts.push(`${staleKfCount} 个关键帧`);
      if (staleVidCount > 0) parts.push(`${staleVidCount} 个视频`);
      return `上游资产已变更，本幕有 ${parts.join('、')} 建议同步更新`;
    }
    return undefined;
  };

  // 计算定妆完成状态 (涵盖角色、场景与核心道具)
  const completedCharCount = characters.filter((c: any) => Boolean(c.imageUrl)).length;
  const totalCharCount = characters.length;
  const completedLocCount = locations.filter((l: any) => Boolean(l.imageUrl)).length;
  const totalLocCount = locations.length;
  const completedItemCount = items.filter((item: any) => Boolean(item.imageUrl || item.referenceImageUrl)).length;
  const totalItemCount = items.length;
  const completedAssetCount = completedCharCount + completedLocCount + completedItemCount;
  const totalAssetCount = totalCharCount + totalLocCount + totalItemCount;

  const hasLookdevReady = totalAssetCount > 0 && completedAssetCount > 0;
  const isLookdevAllDone = totalAssetCount > 0 && completedAssetCount >= totalAssetCount;

  // 辅助反查某个 clip 是否正在生成/推演中 (精准匹配单幕 ID)
  const isClipGenerating = (clipId: string): boolean => {
    return tasks.some((t) => {
      if (t.status !== 'running' && t.status !== 'pending') return false;
      const targetClipId = t.input?.clipId || t.input?.id;
      if (!targetClipId) return false;
      if (
        t.toolName === 'film.storyboard_breakdown' ||
        t.toolName === 'film.shot_keyframe' ||
        t.toolName === 'film.shot_video'
      ) {
        return targetClipId === clipId;
      }
      return false;
    });
  };

  // 辅助反查某个 clip 的分镜与电影规范实体
  const findClipData = (clipId: string): any => {
    const inStoryboards = storyboards.find(
      (s: any) =>
        s.clipId === clipId ||
        s.id === clipId ||
        s.sourceNodeId === clipId ||
        s.clipId === `c${clipId.replace(/\D/g, '')}`
    );
    if (inStoryboards) return inStoryboards;

    if (filmSpec?.clips && Array.isArray(filmSpec.clips)) {
      return filmSpec.clips.find(
        (c: any) =>
          c.clipId === clipId ||
          c.sourceNodeId === clipId ||
          c.clipId === `c${clipId.replace(/\D/g, '')}`
      );
    }
    return undefined;
  };

  // 辅助反查某个 clip 是否已有分镜规划产物
  const isClipStoryboardPlanned = (clipId: string): boolean => {
    const clipData = findClipData(clipId);
    return Array.isArray(clipData?.shots) && clipData.shots.length > 0;
  };

  // 辅助计算某个 clip 的视频成片进展：总镜头数、已生成视频数、是否全部镜头均有视频
  const getClipVideoProgress = (clipId: string) => {
    const clipData = findClipData(clipId);
    const shots: any[] = Array.isArray(clipData?.shots) ? clipData.shots : [];
    const totalShots = shots.length;
    const completedVideos = shots.filter((s) => {
      const v = typeof s.videoUrl === 'string' ? s.videoUrl.split('?')[0].trim() : '';
      return Boolean(v);
    }).length;
    // 【核心铁律】：完成判断是每个分镜都有视频
    const isAllVideosCompleted = totalShots > 0 && completedVideos >= totalShots;
    return { totalShots, completedVideos, isAllVideosCompleted, shots };
  };

  // 辅助反查某个 clip 的所有分镜视频 URL 列表（按镜头因果顺序，剔除空项）
  const getClipVideoList = (clipId: string): string[] => {
    const clipData = findClipData(clipId);
    const shots: any[] = Array.isArray(clipData?.shots) ? clipData.shots : [];
    const shotVideos = shots
      .map((s) => (typeof s.videoUrl === 'string' ? s.videoUrl.split('?')[0].trim() : ''))
      .filter(Boolean);

    if (shotVideos.length > 0) return shotVideos;
    if (clipData?.videoUrl && typeof clipData.videoUrl === 'string') {
      const fullUrl = clipData.videoUrl.split('?')[0].trim();
      if (fullUrl) return [fullUrl];
    }
    return [];
  };

  // 辅助反查某个 clip 的关键帧预览图
  const getClipKeyframeUrl = (clipId: string): string | undefined => {
    const clipData = findClipData(clipId);
    if (clipData?.firstFrameImageUrl) return clipData.firstFrameImageUrl;
    if (clipData?.keyframeUrl) return clipData.keyframeUrl;
    if (Array.isArray(clipData?.shots) && clipData.shots.length > 0) {
      for (const s of clipData.shots) {
        const url = s.firstFrameImageUrl || s.keyframeUrl;
        if (url) return url;
      }
    }
    return undefined;
  };

  // 辅助反查某个 clip 的合成/首选视频 URL
  const getClipVideoUrl = (clipId: string): string | undefined => {
    const list = getClipVideoList(clipId);
    return list.length > 0 ? list[0] : undefined;
  };

  // 1. 构建因果决策树节点与穿透分叉连线数据
  const { nodes, edges, bounds } = useMemo(() => {
    const rawClips = prd?.clips || [];
    const wiring = prd?.wiring || [];
    const interactions = prd?.interactions || [];
    const rawEndings = prd?.endings || [];

    const nodeList: TopoNode[] = [];
    const edgeList: TopoEdge[] = [];

    // 16:9 极简播放器卡片尺寸
    const CLIP_W = 264;
    const CLIP_H = 152;
    const LOOKDEV_W = 264;
    const LOOKDEV_H = 126;
    const ROW_GAP = 120;
    const BRANCH_SPREAD_X = 560;
    const CENTER_X = 600;
    const ROOT_Y = 50;

    // A. 根节点：全剧视觉定妆母体 (微倾斜相纸叠层)
    let lookdevStatus: 'locked' | 'pending' | 'in_progress' | 'completed' = 'pending';
    let lookdevBadge = '🎨 视觉定妆 · 待提取';
    let lookdevBadgeColor = 'bg-slate-100 text-slate-600 border-slate-200';

    if (totalAssetCount === 0) {
      lookdevStatus = 'pending';
      lookdevBadge = '🎨 视觉定妆 · 待提取';
      lookdevBadgeColor = 'bg-slate-100 text-slate-600 border-slate-200';
    } else if (isLookdevAllDone) {
      lookdevStatus = 'completed';
      lookdevBadge = `🎨 视觉定妆 (${completedAssetCount}/${totalAssetCount})`;
      lookdevBadgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    } else if (completedAssetCount > 0) {
      lookdevStatus = 'in_progress';
      lookdevBadge = `🎨 视觉定妆 (${completedAssetCount}/${totalAssetCount})`;
      lookdevBadgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-200';
    } else {
      lookdevStatus = 'pending';
      lookdevBadge = `🎨 视觉定妆 (0/${totalAssetCount})`;
      lookdevBadgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
    }

    nodeList.push({
      id: 'node_lookdev_root',
      kind: 'lookdev',
      title: '全剧视觉定妆母体',
      badge: lookdevBadge,
      badgeColor: lookdevBadgeColor,
      status: lookdevStatus,
      isUnlocked: true,
      x: CENTER_X - LOOKDEV_W / 2,
      y: ROOT_Y,
      w: LOOKDEV_W,
      h: LOOKDEV_H,
    });

    // B. 分析互动节点关系与互斥分支集合 (Siblings)
    const interactionParentMap = new Map<string, string>();
    const interactionBranchesMap = new Map<string, Array<{ branchClipId: string; outcomeKey: string; label: string }>>();
    const siblingBranchSet = new Set<string>();

    wiring.forEach((w: any) => {
      if (w.to && w.to.startsWith('I_') && !w.from.startsWith('I_')) {
        interactionParentMap.set(w.to, w.from);
      }
    });

    wiring.forEach((w: any) => {
      if (w.from && w.from.startsWith('I_')) {
        const interId = w.from;
        const inter = interactions.find((i: any) => i.id === interId);
        const outcome = inter?.outcomes?.find((o: any) => o.key === w.onOutcome);
        const label = outcome?.label ? `${w.onOutcome}·${outcome.label.slice(0, 8)}…` : `分支 ${w.onOutcome}`;

        const list = interactionBranchesMap.get(interId) || [];
        list.push({ branchClipId: w.to, outcomeKey: w.onOutcome, label });
        interactionBranchesMap.set(interId, list);
        siblingBranchSet.add(w.to);
      }
    });

    // C. 因果树分层排版算法 (Act & Parallel Branch Layering)
    const clipNodeMap = new Map<string, TopoNode>();
    let currentY = ROOT_Y + LOOKDEV_H + ROW_GAP;

    const evaluateClipStatus = (clipId: string, isRoot: boolean, parentClipId?: string) => {
      let isUnlocked = false;
      let status: 'locked' | 'pending' | 'in_progress' | 'completed' = 'locked';
      let badge = '🔒 待解锁';
      let badgeColor = 'bg-slate-100 text-slate-400 border-slate-200';

      const isGeneratingThis = isClipGenerating(clipId);
      const hasStoryboard = isClipStoryboardPlanned(clipId);
      const { totalShots, completedVideos, isAllVideosCompleted } = getClipVideoProgress(clipId);

      // 本幕状态判定
      if (isGeneratingThis) {
        status = 'in_progress';
        badge = '⏳ 推演中';
        badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-200';
      } else if (!hasStoryboard) {
        status = 'pending';
        badge = '🎬 待规划分镜';
        badgeColor = 'bg-slate-100 text-slate-600 border-slate-200';
      } else if (isAllVideosCompleted) {
        // 【核心铁律】：只有每个分镜镜头都有已生成的有效视频，才算 completed！
        status = 'completed';
        badge = `✅ 全片就绪 (${totalShots}/${totalShots})`;
        badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      } else if (completedVideos > 0) {
        status = 'in_progress';
        badge = `🎬 视频成片中 (${completedVideos}/${totalShots})`;
        badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
      } else {
        // 规划了分镜，但尚未生成任何分镜视频
        status = 'pending';
        badge = `🎬 分镜就绪 (0/${totalShots} 视频)`;
        badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-200';
      }

      // 下游解锁因果门禁判定
      if (isRoot) {
        // 根节点（第 1 幕）：视觉定妆就绪即可解锁创作
        isUnlocked = hasLookdevReady;
        if (!isUnlocked) {
          status = 'locked';
          badge = '🔒 待定妆就绪';
          badgeColor = 'bg-slate-100 text-slate-400 border-slate-200';
        }
      } else {
        // 【核心铁律】：下游分支节点，只有前驱父节点已【全部完成视频】（每个分镜都有视频），才允许解锁！
        const parentProgress = parentClipId ? getClipVideoProgress(parentClipId) : null;
        const parentAllDone = parentProgress ? parentProgress.isAllVideosCompleted : false;

        isUnlocked = hasLookdevReady && (parentAllDone || isAllVideosCompleted);
        if (!isUnlocked) {
          status = 'locked';
          badge = parentProgress && !parentProgress.isAllVideosCompleted
            ? '🔒 需前驱各镜成片'
            : '🔒 需前驱就绪';
          badgeColor = 'bg-slate-100 text-slate-400 border-slate-200';
        }
      }

      return { isUnlocked, status, badge, badgeColor, totalShots, completedVideos };
    };

    const actClips = rawClips.filter((c) => !siblingBranchSet.has(c.id));
    let previousActId: string | null = null;
    let previousBranches: string[] = [];

    actClips.forEach((act, actIdx) => {
      const isFirst = actIdx === 0;

      // 1. 如果前一幕有分支，排布前一幕的分支节点 (横向展开左右对称)
      if (previousActId) {
        const branchesForPrev: Array<{ branchClipId: string; label: string }> = [];
        interactionBranchesMap.forEach((branches, interId) => {
          if (interactionParentMap.get(interId) === previousActId) {
            branchesForPrev.push(...branches);
          }
        });

        if (branchesForPrev.length > 0) {
          const count = branchesForPrev.length;
          previousBranches = branchesForPrev.map((b) => b.branchClipId);

          branchesForPrev.forEach((bInfo, bIdx) => {
            const branchClip = rawClips.find((c) => c.id === bInfo.branchClipId);
            if (!branchClip) return;

            const bX = CENTER_X + (bIdx - (count - 1) / 2) * BRANCH_SPREAD_X - CLIP_W / 2;
            const bY = currentY;

            const { isUnlocked, status, badge, badgeColor, totalShots, completedVideos } = evaluateClipStatus(
              branchClip.id,
              false,
              previousActId!
            );
            const keyframeUrl = getClipKeyframeUrl(branchClip.id);
            const videoUrl = getClipVideoUrl(branchClip.id);
            const videoUrls = getClipVideoList(branchClip.id);

            const bNode: TopoNode = {
              id: `node_${branchClip.id}`,
              kind: 'clip',
              clipId: branchClip.id,
              title: branchClip.title || `分支 ${bIdx + 1}`,
              badge,
              badgeColor,
              status,
              isUnlocked,
              keyframeUrl,
              videoUrl,
              videoUrls,
              totalShots,
              completedVideos,
              durationSec: 15,
              staleReason: getClipStaleReason(branchClip.id),
              x: bX,
              y: bY,
              w: CLIP_W,
              h: CLIP_H,
            };

            nodeList.push(bNode);
            clipNodeMap.set(branchClip.id, bNode);

            // 连线：从 previousActId 分叉连向分支
            const prevActNode = clipNodeMap.get(previousActId!);
            if (prevActNode) {
              const fx = prevActNode.x + CLIP_W / 2;
              const fy = prevActNode.y + CLIP_H;
              const tx = bX + CLIP_W / 2;
              const ty = bY;

              edgeList.push({
                id: `edge_${previousActId}_to_${branchClip.id}`,
                fromId: prevActNode.id,
                toId: bNode.id,
                label: bInfo.label,
                isUnlocked: prevActNode.isUnlocked && bNode.isUnlocked,
                path: `M ${fx} ${fy} C ${fx} ${fy + 60}, ${tx} ${ty - 60}, ${tx} ${ty}`,
                lx: (fx + tx) / 2,
                ly: (fy + ty) / 2,
              });
            }
          });

          currentY += CLIP_H + ROW_GAP;
        }
      }

      // 2. 排布当前主干幕次节点 (居中对齐)
      const actX = CENTER_X - CLIP_W / 2;
      const actY = currentY;

      let parentForThisAct = previousActId || undefined;
      const { isUnlocked, status, badge, badgeColor, totalShots, completedVideos } = evaluateClipStatus(
        act.id,
        isFirst,
        previousBranches.length > 0 ? previousBranches[0] : parentForThisAct
      );
      const keyframeUrl = getClipKeyframeUrl(act.id);
      const videoUrl = getClipVideoUrl(act.id);
      const videoUrls = getClipVideoList(act.id);

      const actNode: TopoNode = {
        id: `node_${act.id}`,
        kind: 'clip',
        clipId: act.id,
        title: act.title || `第 ${actIdx + 1} 幕`,
        badge,
        badgeColor,
        status,
        isUnlocked,
        keyframeUrl,
        videoUrl,
        videoUrls,
        totalShots,
        completedVideos,
        durationSec: 20,
        staleReason: getClipStaleReason(act.id),
        x: actX,
        y: actY,
        w: CLIP_W,
        h: CLIP_H,
      };

      nodeList.push(actNode);
      clipNodeMap.set(act.id, actNode);

      // 连线：
      if (isFirst) {
        // 定妆母体连向第一幕
        const rootNode = nodeList[0];
        const fx = rootNode.x + LOOKDEV_W / 2;
        const fy = rootNode.y + LOOKDEV_H;
        const tx = actX + CLIP_W / 2;
        const ty = actY;

        edgeList.push({
          id: 'edge_root_to_first',
          fromId: rootNode.id,
          toId: actNode.id,
          label: '定妆就绪 ➔ 首幕推演',
          isUnlocked: hasLookdevReady,
          path: `M ${fx} ${fy} C ${fx} ${fy + 50}, ${tx} ${ty - 50}, ${tx} ${ty}`,
          lx: (fx + tx) / 2,
          ly: (fy + ty) / 2,
        });
      } else if (previousBranches.length > 0) {
        // 从上一幕的各分支共同汇聚连向当前主干幕次
        previousBranches.forEach((bId, bIdx) => {
          const bNode = clipNodeMap.get(bId);
          if (bNode) {
            const fx = bNode.x + CLIP_W / 2;
            const fy = bNode.y + CLIP_H;
            const tx = actX + CLIP_W / 2;
            const ty = actY;

            edgeList.push({
              id: `edge_branch_${bId}_to_${act.id}_${bIdx}`,
              fromId: bNode.id,
              toId: actNode.id,
              label: '推进',
              isUnlocked: bNode.isUnlocked && actNode.isUnlocked,
              path: `M ${fx} ${fy} C ${fx} ${fy + 60}, ${tx} ${ty - 60}, ${tx} ${ty}`,
              lx: (fx + tx) / 2,
              ly: (fy + ty) / 2,
            });
          }
        });
        previousBranches = [];
      } else if (previousActId) {
        const prevNode = clipNodeMap.get(previousActId);
        if (prevNode) {
          const fx = prevNode.x + CLIP_W / 2;
          const fy = prevNode.y + CLIP_H;
          const tx = actX + CLIP_W / 2;
          const ty = actY;

          edgeList.push({
            id: `edge_${previousActId}_to_${act.id}`,
            fromId: prevNode.id,
            toId: actNode.id,
            label: '顺向推进',
            isUnlocked: prevNode.isUnlocked && actNode.isUnlocked,
            path: `M ${fx} ${fy} C ${fx} ${fy + 50}, ${tx} ${ty - 50}, ${tx} ${ty}`,
            lx: (fx + tx) / 2,
            ly: (fy + ty) / 2,
          });
        }
      }

      previousActId = act.id;
      currentY += CLIP_H + ROW_GAP;
    });

    // 3. 处理最后一幕的分支与结局
    if (previousActId) {
      const branchesForLast: Array<{ branchClipId: string; label: string }> = [];
      interactionBranchesMap.forEach((branches, interId) => {
        if (interactionParentMap.get(interId) === previousActId) {
          branchesForLast.push(...branches);
        }
      });

      if (branchesForLast.length > 0) {
        const count = branchesForLast.length;
        const lastBranches: string[] = [];

        branchesForLast.forEach((bInfo, bIdx) => {
          const branchClip = rawClips.find((c) => c.id === bInfo.branchClipId);
          if (!branchClip) return;
          lastBranches.push(branchClip.id);

          const bX = CENTER_X + (bIdx - (count - 1) / 2) * BRANCH_SPREAD_X - CLIP_W / 2;
          const bY = currentY;

          const { isUnlocked, status, badge, badgeColor } = evaluateClipStatus(branchClip.id, false, previousActId!);
          const keyframeUrl = getClipKeyframeUrl(branchClip.id);
          const videoUrl = getClipVideoUrl(branchClip.id);

          const bNode: TopoNode = {
            id: `node_${branchClip.id}`,
            kind: 'clip',
            clipId: branchClip.id,
            title: branchClip.title || `终局分支 ${bIdx + 1}`,
            badge,
            badgeColor,
            status,
            isUnlocked,
            keyframeUrl,
            videoUrl,
            durationSec: 15,
            staleReason: getClipStaleReason(branchClip.id),
            x: bX,
            y: bY,
            w: CLIP_W,
            h: CLIP_H,
          };

          nodeList.push(bNode);
          clipNodeMap.set(branchClip.id, bNode);

          const prevActNode = clipNodeMap.get(previousActId!);
          if (prevActNode) {
            const fx = prevActNode.x + CLIP_W / 2;
            const fy = prevActNode.y + CLIP_H;
            const tx = bX + CLIP_W / 2;
            const ty = bY;

            edgeList.push({
              id: `edge_${previousActId}_to_${branchClip.id}`,
              fromId: prevActNode.id,
              toId: bNode.id,
              label: bInfo.label,
              isUnlocked: prevActNode.isUnlocked && bNode.isUnlocked,
              path: `M ${fx} ${fy} C ${fx} ${fy + 60}, ${tx} ${ty - 60}, ${tx} ${ty}`,
              lx: (fx + tx) / 2,
              ly: (fy + ty) / 2,
            });
          }
        });

        currentY += CLIP_H + ROW_GAP;

        // 通关结局节点
        if (rawEndings.length > 0) {
          const ending = rawEndings[0];
          const isEndingUnlocked = lastBranches.some((bId) => isClipStoryboardPlanned(bId));
          const endX = CENTER_X - CLIP_W / 2;
          const endY = currentY;

          const endNode: TopoNode = {
            id: `node_${ending.id}`,
            kind: 'ending',
            title: ending.title || '通关结局',
            badge: ending.isVictory ? '🏆 HE 通关' : '🎬 完结',
            badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            status: isEndingUnlocked ? 'completed' : 'locked',
            isUnlocked: isEndingUnlocked,
            durationSec: 25,
            x: endX,
            y: endY,
            w: CLIP_W,
            h: CLIP_H,
          };

          nodeList.push(endNode);

          lastBranches.forEach((bId, bIdx) => {
            const bNode = clipNodeMap.get(bId);
            if (bNode) {
              const fx = bNode.x + CLIP_W / 2;
              const fy = bNode.y + CLIP_H;
              const tx = endX + CLIP_W / 2;
              const ty = endY;

              edgeList.push({
                id: `edge_branch_${bId}_to_ending_${bIdx}`,
                fromId: bNode.id,
                toId: endNode.id,
                label: '结局收敛',
                isUnlocked: bNode.isUnlocked && isEndingUnlocked,
                path: `M ${fx} ${fy} C ${fx} ${fy + 60}, ${tx} ${ty - 60}, ${tx} ${ty}`,
                lx: (fx + tx) / 2,
                ly: (fy + ty) / 2,
              });
            }
          });
        }
      }
    }

    // 计算包围盒
    let minX = CENTER_X - 400;
    let maxX = CENTER_X + 400;
    let minY = ROOT_Y;
    let maxY = currentY + 120;

    nodeList.forEach((n) => {
      if (n.x < minX) minX = n.x;
      if (n.x + n.w > maxX) maxX = n.x + n.w;
      if (n.y < minY) minY = n.y;
      if (n.y + n.h > maxY) maxY = n.y + n.h;
    });

    return {
      nodes: nodeList,
      edges: edgeList,
      bounds: {
        width: Math.max(1300, maxX - minX + 350),
        height: Math.max(850, maxY - minY + 150),
        minX,
        minY,
      },
    };
  }, [prd, entities, storyboards, filmSpec, staleMap, completedCharCount, totalCharCount, hasLookdevReady, isLookdevAllDone, tasks, completedItemCount, totalItemCount]);

  // 画布平移处理
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setDragStart({ x: e.clientX - viewport.x, y: e.clientY - viewport.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setViewport((prev) => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    }));
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setViewport((prev) => {
      const nextZoom = Math.min(1.8, Math.max(0.35, prev.zoom * zoomFactor));
      return { ...prev, zoom: nextZoom };
    });
  };

  const handleNodeClick = (node: TopoNode) => {
    onSelectNode?.(node);
  };

  const handleNodeDoubleClick = (node: TopoNode) => {
    if (!node.isUnlocked) {
      setLockedToast(`🔒 该节点尚未解锁：需先完成前驱工序（全剧视觉定妆或上游前驱分镜）！`);
      setTimeout(() => setLockedToast(null), 3500);
      return;
    }
    if (node.kind === 'lookdev') {
      onEnterSubCanvas?.('lookdev');
    } else if (node.kind === 'clip' && node.clipId) {
      onEnterSubCanvas?.('clip', node.clipId, node.title);
    }
  };

  // 智能提取全剧视觉定妆母本预览卡片实体（优先展示已出图的实体，自适应横版画幅）
  const readyChars = characters.filter((c: any) => Boolean(c.imageUrl));
  const readyLocs = locations.filter((l: any) => Boolean(l.imageUrl));
  const displayEntities = [...readyChars, ...readyLocs, ...characters, ...locations];
  const primaryEntity = displayEntities[0];
  const secondaryEntity = displayEntities[1];
  const tertiaryEntity = displayEntities[2];

  const charImage0 = primaryEntity?.imageUrl || '';
  const charImage1 = secondaryEntity?.imageUrl || '';
  const charImage2 = tertiaryEntity?.imageUrl || '';
  const primaryName = primaryEntity
    ? `${primaryEntity.name || '核心资产'}${primaryEntity.identity ? ` · ${primaryEntity.identity}` : ''}`
    : '全剧视觉定妆母体';
  const isPrimaryLocation = !readyChars.includes(primaryEntity) && readyLocs.includes(primaryEntity);

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      className={`relative w-full h-full overflow-hidden select-none bg-[#f8fafc] ${
        isPanning ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {/* 现代优雅浅色工程网格点阵 */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-60">
        <defs>
          <pattern id="light_dot_grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.2" fill="#cbd5e1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#light_dot_grid)" />
      </svg>

      {/* 锁定提示 Toast */}
      {lockedToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-slate-900/90 text-white backdrop-blur-md px-4 py-2.5 rounded-2xl shadow-xl border border-slate-700 text-xs font-semibold animate-in fade-in slide-in-from-top-2 duration-200 flex items-center space-x-2">
          <span>{lockedToast}</span>
        </div>
      )}

      {/* 画布缩放控制器 (浅色系) */}
      <div className="absolute bottom-6 right-6 z-20 bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl p-1.5 shadow-sm flex items-center space-x-1">
        <button
          onClick={() => setViewport((prev) => ({ ...prev, zoom: Math.min(1.8, prev.zoom * 1.15) }))}
          className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-700 font-bold text-sm flex items-center justify-center transition cursor-pointer"
          title="放大"
        >
          ＋
        </button>
        <span className="text-[11px] font-mono text-slate-500 px-1">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          onClick={() => setViewport((prev) => ({ ...prev, zoom: Math.max(0.35, prev.zoom * 0.85) }))}
          className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-700 font-bold text-sm flex items-center justify-center transition cursor-pointer"
          title="缩小"
        >
          －
        </button>
        <button
          onClick={() => setViewport({ x: 60, y: 30, zoom: 0.88 })}
          className="px-2.5 h-8 rounded-xl hover:bg-slate-100 text-slate-600 font-semibold text-xs flex items-center justify-center transition cursor-pointer"
          title="重置居中"
        >
          重置
        </button>
      </div>

      {/* 主 SVG 拓扑画布 */}
      <div
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
          transition: isPanning ? 'none' : 'transform 0.1s ease-out',
        }}
        className="absolute top-0 left-0"
      >
        <svg
          width={bounds.width}
          height={bounds.height}
          className="overflow-visible"
        >
          <defs>
            <marker
              id="topo_arrow_active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#6366f1" />
            </marker>
            <marker
              id="topo_arrow_locked"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#cbd5e1" />
            </marker>
            <marker
              id="topo_arrow_hover"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#4338ca" />
            </marker>

            {/* 16:9 整卡圆角剪裁路径 */}
            <clipPath id="clip_full_player_card">
              <rect x="0" y="0" width="264" height="152" rx="14" />
            </clipPath>

            {/* 定妆底层与中层相纸剪裁路径 (宽幅错落相纸 144*96) */}
            <clipPath id="polaroid_photo_clip">
              <rect x="4" y="4" width="144" height="96" rx="6" />
            </clipPath>
            {/* 定妆顶层相纸剪裁路径 (纯净画幅 148*98，全身完整展示，无遮挡无留白) */}
            <clipPath id="polaroid_top_clip">
              <rect x="4" y="4" width="148" height="98" rx="6" />
            </clipPath>

            {/* 生成中动态全屏扫光渐变 */}
            <linearGradient id="scanline_sweep" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#818cf8" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.1" />
              <animate attributeName="y1" values="-1; 1" dur="2s" repeatCount="indefinite" />
              <animate attributeName="y2" values="0; 2" dur="2s" repeatCount="indefinite" />
            </linearGradient>

            {/* 锁定态微网格纹理 */}
            <pattern id="locked_grid_pattern" width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M 0 12 L 12 0 M 6 12 L 12 6 M 0 6 L 6 0" stroke="#1e293b" strokeWidth="0.8" />
            </pattern>
          </defs>

          {/* 1. 渲染连接线 */}
          {edges.map((edge) => {
            const isHovered = hoveredNodeId && (edge.fromId === hoveredNodeId || edge.toId === hoveredNodeId);

            return (
              <g key={edge.id}>
                <path
                  d={edge.path}
                  fill="none"
                  stroke={isHovered ? '#4338ca' : edge.isUnlocked ? '#6366f1' : '#cbd5e1'}
                  strokeWidth={isHovered ? '2.5' : edge.isUnlocked ? '2' : '1.5'}
                  strokeDasharray={edge.isUnlocked ? undefined : '5,5'}
                  markerEnd={
                    isHovered
                      ? 'url(#topo_arrow_hover)'
                      : edge.isUnlocked
                      ? 'url(#topo_arrow_active)'
                      : 'url(#topo_arrow_locked)'
                  }
                  className="transition-colors duration-200"
                />
                {edge.label && (
                  <g transform={`translate(${edge.lx}, ${edge.ly})`}>
                    <rect
                      x={-((edge.label.length * 10 + 16) / 2)}
                      y="-10"
                      width={edge.label.length * 10 + 16}
                      height="20"
                      rx="10"
                      fill="#ffffff"
                      stroke={isHovered ? '#818cf8' : edge.isUnlocked ? '#e0e7ff' : '#e2e8f0'}
                      strokeWidth="1"
                      className="shadow-2xs"
                    />
                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      fill={isHovered ? '#312e81' : edge.isUnlocked ? '#4f46e5' : '#94a3b8'}
                      fontSize="9.5"
                      fontWeight="600"
                      fontFamily="sans-serif"
                    >
                      {edge.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* 2. 渲染各节点 */}
          {nodes.map((node) => {
            const isClickable = node.isUnlocked;
            const isHovered = hoveredNodeId === node.id;
            const isSelected = selectedNodeId === node.id;
            const hasKeyframe = Boolean(node.keyframeUrl);
            const isGeneratingThis = node.status === 'in_progress';
            const isLockedThis = !node.isUnlocked;

            // ─────────────────────────────────────────────────────────────
            // 节点渲染 A：全剧视觉定妆母体 (经典相纸错落展开叠层 Polaroid Stack - 纯净无文字，清晰透出底层图片)
            // ─────────────────────────────────────────────────────────────
            if (node.kind === 'lookdev') {
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNodeClick(node);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleNodeDoubleClick(node);
                  }}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  className="cursor-pointer select-none"
                >
                  {/* 全域透明点击与悬停感应底板 (确保相纸与四周 100% 灵敏响应单击弹出侧边栏) */}
                  <rect
                    x="10"
                    y="-18"
                    width={node.w - 20}
                    height={node.h + 24}
                    fill="transparent"
                    pointerEvents="all"
                  />

                  {/* 选中高亮光环底盘 */}
                  {isSelected && (
                    <rect
                      x="36"
                      y="6"
                      width="188"
                      height="128"
                      rx="14"
                      fill="#e0e7ff"
                      fillOpacity="0.4"
                      stroke="#6366f1"
                      strokeWidth="2"
                      strokeDasharray="4,4"
                      className="animate-pulse"
                    />
                  )}

                  {/* 底层相纸：逆时针明显倾斜 -9deg，向左探出，清晰可见底层图片 */}
                  <g transform="translate(36, 16) rotate(-9, 76, 54)">
                    <rect
                      width="152"
                      height="108"
                      rx="10"
                      fill="#ffffff"
                      stroke="#e2e8f0"
                      strokeWidth="1.2"
                      style={{ filter: 'drop-shadow(0 4px 10px rgba(0, 0, 0, 0.08))' }}
                    />
                    {charImage2 ? (
                      <image
                        href={charImage2}
                        x="4"
                        y="4"
                        width="144"
                        height="96"
                        preserveAspectRatio="xMidYMid meet"
                        clipPath="url(#polaroid_photo_clip)"
                        opacity="0.9"
                      />
                    ) : (
                      <rect x="4" y="4" width="144" height="96" rx="6" fill="#f1f5f9" />
                    )}
                  </g>

                  {/* 中层相纸：顺时针明显倾斜 +9deg，向右探出，清晰可见底层图片 */}
                  <g transform="translate(72, 14) rotate(9, 76, 54)">
                    <rect
                      width="152"
                      height="108"
                      rx="10"
                      fill="#ffffff"
                      stroke="#e2e8f0"
                      strokeWidth="1.2"
                      style={{ filter: 'drop-shadow(0 6px 14px rgba(0, 0, 0, 0.1))' }}
                    />
                    {charImage1 ? (
                      <image
                        href={charImage1}
                        x="4"
                        y="4"
                        width="144"
                        height="96"
                        preserveAspectRatio="xMidYMid meet"
                        clipPath="url(#polaroid_photo_clip)"
                        opacity="0.92"
                      />
                    ) : (
                      <rect x="4" y="4" width="144" height="96" rx="6" fill="#e2e8f0" />
                    )}
                  </g>

                  {/* 顶层主相纸：居中 0deg (拍立得画幅，全身完整展示，绝无遮头与大片留白，纯净无文字) */}
                  <g transform="translate(52, 14)">
                    <rect
                      width="156"
                      height="112"
                      rx="10"
                      fill="#ffffff"
                      stroke={isSelected ? '#4f46e5' : isHovered ? '#6366f1' : '#cbd5e1'}
                      strokeWidth={isSelected ? '2.5' : isHovered ? '2' : '1.2'}
                      style={{
                        filter: isSelected
                          ? 'drop-shadow(0 8px 24px rgba(79, 70, 229, 0.35))'
                          : isHovered
                          ? 'drop-shadow(0 8px 22px rgba(99, 102, 241, 0.25))'
                          : 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.12))',
                        transition: 'stroke 0.2s ease, filter 0.2s ease',
                      }}
                    />

                    {/* 图片预览区 (纯净画面，无任何多余文字) */}
                    {charImage0 ? (
                      <image
                        href={charImage0}
                        x="4"
                        y="4"
                        width="148"
                        height="98"
                        preserveAspectRatio="xMidYMid meet"
                        clipPath="url(#polaroid_top_clip)"
                      />
                    ) : (
                      <g>
                        <rect x="4" y="4" width="148" height="98" rx="6" fill="#f8fafc" />
                        <text x="78" y="48" textAnchor="middle" fill="#94a3b8" fontSize="24">
                          🎨
                        </text>
                        <text x="78" y="70" textAnchor="middle" fill="#94a3b8" fontSize="10" fontWeight="600" fontFamily="sans-serif">
                          {totalAssetCount === 0 ? '待提取设定' : '待生成立绘'}
                        </text>
                      </g>
                    )}
                  </g>

                  {/* 顶部浮动胶囊徽章 (安全悬浮于卡片上方，彻底杜绝遮挡头部画面) */}
                  <g transform={`translate(${node.w / 2}, -2)`}>
                    <rect
                      x="-88"
                      y="-12"
                      width="176"
                      height="24"
                      rx="12"
                      fill="#ffffff"
                      stroke={isHovered ? '#6366f1' : '#818cf8'}
                      strokeWidth="1.5"
                      style={{ filter: 'drop-shadow(0 2px 8px rgba(99, 102, 241, 0.18))' }}
                    />
                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      fill="#4338ca"
                      fontSize="10.5"
                      fontWeight="700"
                      fontFamily="sans-serif"
                    >
                      {node.badge}
                    </text>
                  </g>
                </g>
              );
            }

            // ─────────────────────────────────────────────────────────────
            // 节点渲染 B：剧情节点 (整图全画幅状态表达 + Hover 交互)
            // ─────────────────────────────────────────────────────────────
            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleNodeClick(node);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleNodeDoubleClick(node);
                }}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                className={`select-none ${isClickable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
              >
                {/* 16:9 卡片外壳底板 */}
                <rect
                  width={node.w}
                  height={node.h}
                  rx="14"
                  fill="#090d16"
                  stroke={
                    isSelected
                      ? '#4f46e5'
                      : isHovered && isClickable
                      ? '#6366f1'
                      : isGeneratingThis
                      ? '#818cf8'
                      : node.status === 'completed'
                      ? '#10b981'
                      : node.isUnlocked
                      ? '#334155'
                      : '#1e293b'
                  }
                  strokeWidth={isSelected ? '2.5' : isHovered && isClickable ? '2' : '1.2'}
                  style={{
                    filter:
                      isSelected
                        ? 'drop-shadow(0 8px 24px rgba(79, 70, 229, 0.35))'
                        : isHovered && isClickable
                        ? 'drop-shadow(0 8px 24px rgba(99, 102, 241, 0.22))'
                        : 'drop-shadow(0 4px 14px rgba(15, 23, 42, 0.12))',
                    transition: 'stroke 0.2s ease, filter 0.2s ease',
                  }}
                />

                {/* ─────────────────────────────────────────────────────────────
                    状态分支 1：【未解锁状态】(全图沉浸式暗黑磨砂压印，绝无小角标)
                   ───────────────────────────────────────────────────────────── */}
                {isLockedThis && (
                  <g clipPath="url(#clip_full_player_card)">
                    <rect width={node.w} height={node.h} fill="#090d16" />
                    <rect width={node.w} height={node.h} fill="url(#locked_grid_pattern)" opacity="0.6" />

                    {/* 中央浮雕锁纹与说明 */}
                    <g transform={`translate(${node.w / 2}, 66)`}>
                      <circle r="22" fill="#0f172a" stroke="#1e293b" strokeWidth="1.5" />
                      <text x="0" y="6" textAnchor="middle" fill="#64748b" fontSize="16">
                        🔒
                      </text>
                    </g>
                    <text
                      x={node.w / 2}
                      y="110"
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize="10.5"
                      fontWeight="600"
                      fontFamily="sans-serif"
                    >
                      未解锁 · 待前驱工序推演
                    </text>
                    {/* 顶部极简标题 */}
                    <text
                      x="14"
                      y="24"
                      fill="#475569"
                      fontSize="11"
                      fontWeight="600"
                      fontFamily="sans-serif"
                    >
                      ▶ {node.title.length > 12 ? node.title.slice(0, 11) + '…' : node.title}
                    </text>
                  </g>
                )}

                {/* ─────────────────────────────────────────────────────────────
                    状态分支 2：【生成中/推演中】(全画幅动态电影扫描线光效)
                   ───────────────────────────────────────────────────────────── */}
                {!isLockedThis && isGeneratingThis && (
                  <g clipPath="url(#clip_full_player_card)">
                    <rect width={node.w} height={node.h} fill="#0c1020" />
                    {/* 动态全图光栅扫描层 */}
                    <rect width={node.w} height={node.h} fill="url(#scanline_sweep)" opacity="0.75" />

                    {/* 中央旋转脉冲流光 */}
                    <g transform={`translate(${node.w / 2}, 64)`}>
                      <circle r="22" fill="none" stroke="#6366f1" strokeWidth="2" strokeDasharray="6,4" className="animate-spin" />
                      <circle r="12" fill="#312e81" opacity="0.6" />
                      <text x="0" y="5" textAnchor="middle" fill="#c7d2fe" fontSize="13">
                        🎬
                      </text>
                    </g>

                    <text
                      x={node.w / 2}
                      y="108"
                      textAnchor="middle"
                      fill="#a5b4fc"
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="sans-serif"
                      className="animate-pulse"
                    >
                      AI 视听分镜推演中...
                    </text>
                    <text
                      x="14"
                      y="24"
                      fill="#818cf8"
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="sans-serif"
                    >
                      ▶ {node.title.length > 12 ? node.title.slice(0, 11) + '…' : node.title}
                    </text>
                  </g>
                )}

                {/* ─────────────────────────────────────────────────────────────
                    状态分支 3：【已解锁但待规划】(极简电影打板器与微光呼吸引导)
                   ───────────────────────────────────────────────────────────── */}
                {!isLockedThis && !isGeneratingThis && !hasKeyframe && (
                  <g clipPath="url(#clip_full_player_card)">
                    <rect width={node.w} height={node.h} fill="#090d16" />
                    {/* 四角极简电影辅助十字线 */}
                    <path d="M 12 18 L 12 12 L 18 12 M 252 18 L 252 12 L 246 12 M 12 134 L 12 140 L 18 140 M 252 134 L 252 140 L 246 140" stroke="#1e293b" strokeWidth="1" />

                    <g transform={`translate(${node.w / 2}, 66)`}>
                      <circle
                        r="22"
                        fill="rgba(30, 41, 59, 0.8)"
                        stroke={isHovered ? '#6366f1' : '#334155'}
                        strokeWidth="1.5"
                        style={{ transition: 'stroke 0.2s ease' }}
                      />
                      <polygon points="-6,-9 10,0 -6,9" fill={isHovered ? '#a5b4fc' : '#94a3b8'} />
                    </g>

                    <text
                      x={node.w / 2}
                      y="110"
                      textAnchor="middle"
                      fill={isHovered ? '#c7d2fe' : '#94a3b8'}
                      fontSize="11"
                      fontWeight="600"
                      fontFamily="sans-serif"
                    >
                      待规划本幕视听分镜
                    </text>
                    <text
                      x="14"
                      y="24"
                      fill="#cbd5e1"
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="sans-serif"
                    >
                      ▶ {node.title.length > 12 ? node.title.slice(0, 11) + '…' : node.title}
                    </text>
                  </g>
                )}

                {/* ─────────────────────────────────────────────────────────────
                    状态分支 4：【已就绪态】(正常态纯图无遮挡，Hover 态播放并浮现控制条)
                   ───────────────────────────────────────────────────────────── */}
                {!isLockedThis && !isGeneratingThis && hasKeyframe && (
                  <g clipPath="url(#clip_full_player_card)">
                    {/* 1. 视听内容呈现区：Hover 且有视频则播放多分镜顺序联合序列，否则纯净呈现首帧大图 */}
                    {isHovered && node.videoUrls && node.videoUrls.length > 0 ? (
                      <SequentialClipVideoPlayer
                        videoUrls={node.videoUrls}
                        width={node.w}
                        height={node.h}
                      />
                    ) : (
                      <image
                        href={node.keyframeUrl}
                        x="0"
                        y="0"
                        width={node.w}
                        height={node.h}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    )}

                    {/* 2. 正常态：顶部极轻微遮罩仅保证标题可读，画面主体 100% 纯净无遮挡 */}
                    {!isHovered && (
                      <g>
                        <rect width={node.w} height="36" fill="url(#title_top_gradient)" opacity="0.8" />
                        <text
                          x="12"
                          y="20"
                          fill="#ffffff"
                          fontSize="11"
                          fontWeight="700"
                          fontFamily="sans-serif"
                          style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.8))' }}
                        >
                          ▶ {node.title.length > 12 ? node.title.slice(0, 11) + '…' : node.title}
                        </text>
                      </g>
                    )}

                    {/* 3. 悬浮态 (Hover)：浮现顶部标题栏与底部简约播放控制条 */}
                    {isHovered && (
                      <g className="animate-in fade-in duration-150">
                        {/* 顶栏半透明磨砂遮罩 */}
                        <rect width={node.w} height="34" fill="rgba(11, 15, 25, 0.85)" />
                        <text
                          x="12"
                          y="21"
                          fill="#ffffff"
                          fontSize="11"
                          fontWeight="700"
                          fontFamily="sans-serif"
                        >
                          ▶ {node.title.length > 12 ? node.title.slice(0, 11) + '…' : node.title}
                        </text>
                        <text
                          x={node.w - 12}
                          y="21"
                          textAnchor="end"
                          fill="#94a3b8"
                          fontSize="9"
                          fontWeight="500"
                          fontFamily="monospace"
                        >
                          854 × 480
                        </text>

                        {/* 底栏半透明播放控制遮罩 */}
                        <rect y={node.h - 32} width={node.w} height="32" fill="rgba(11, 15, 25, 0.9)" />

                        {/* 播放/暂停 图标 */}
                        <text x="12" y={node.h - 12} fill="#ffffff" fontSize="10" fontFamily="sans-serif">
                          {node.videoUrl ? '||' : '▶'}
                        </text>

                        {/* 当前时间戳 */}
                        <text x="26" y={node.h - 12} fill="#e2e8f0" fontSize="8.5" fontFamily="monospace">
                          0:01
                        </text>

                        {/* 进度控制条与白色游标 */}
                        <line
                          x1="54"
                          y1={node.h - 15.5}
                          x2={node.w - 68}
                          y2={node.h - 15.5}
                          stroke="#334155"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                        <line
                          x1="54"
                          y1={node.h - 15.5}
                          x2={54 + (node.w - 122) * 0.4}
                          y2={node.h - 15.5}
                          stroke="#6366f1"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                        <circle
                          cx={54 + (node.w - 122) * 0.4}
                          cy={node.h - 15.5}
                          r="3"
                          fill="#ffffff"
                          stroke="#6366f1"
                          strokeWidth="1.5"
                        />

                        {/* 总时长 */}
                        <text x={node.w - 60} y={node.h - 12} fill="#94a3b8" fontSize="8.5" fontFamily="monospace">
                          0:{node.durationSec || 15}
                        </text>

                        {/* 右下角【放大查看】按钮 (Enlarge Button) */}
                        <g
                          transform={`translate(${node.w - 28}, ${node.h - 22})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const clipData = node.clipId ? findClipData(node.clipId) : undefined;
                            const shots: any[] = Array.isArray(clipData?.shots) ? clipData.shots : [];
                            const gallery = shots.map((s, idx) => ({
                              title: `${node.title} · 分镜 ${idx + 1}`,
                              imageUrl: s.firstFrameImageUrl || s.keyframeUrl,
                              videoUrl: typeof s.videoUrl === 'string' && s.videoUrl.trim() ? s.videoUrl.trim() : undefined,
                              subtitle: s.sceneSubject || s.title || `第 ${idx + 1} 镜头视听切片`,
                            }));
                            onEnlargeClip?.({
                              title: node.title,
                              imageUrl: node.keyframeUrl,
                              videoUrl: node.videoUrl,
                              gallery: gallery.length > 0 ? gallery : undefined,
                            });
                          }}
                          className="cursor-pointer hover:opacity-100 opacity-80"
                        >
                          <rect width="16" height="14" rx="3" fill="#1e293b" stroke="#818cf8" strokeWidth="1" />
                          {/* 展开对角线箭头图标 */}
                          <path
                            d="M 4 4 L 7 4 M 4 4 L 4 7 M 12 10 L 9 10 M 12 10 L 12 7 M 4 4 L 7 7 M 12 10 L 9 7"
                            stroke="#ffffff"
                            strokeWidth="1"
                            strokeLinecap="round"
                          />
                        </g>
                      </g>
                    )}
                  </g>
                )}

                {!isLockedThis && node.staleReason && (
                  <g transform={`translate(${node.w - 78}, 8)`} className="pointer-events-auto">
                    <title>{node.staleReason}</title>
                    <rect width="70" height="18" rx="6" fill="rgba(245, 158, 11, 0.92)" />
                    <text
                      x="35"
                      y="12.5"
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9.5"
                      fontWeight="700"
                      fontFamily="sans-serif"
                    >
                      ⚠ 待同步
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
