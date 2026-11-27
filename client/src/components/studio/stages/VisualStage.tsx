/**
 * client/src/components/studio/stages/VisualStage.tsx
 * 工序 2：视听制作工坊根组件 (Visual Stage SSOT)
 *
 * 核心架构机制：
 * 1. 【宏观拓扑主画布】默认展示视听制作流向拓扑图 (VisualPipelineTopology)；
 * 2. 【轻量右侧检视器】单击节点展示 VisualInspectorPanel (看剧本文本、直接播放视频、预览定妆，不可修改，零遮罩阻隔)；
 * 3. 【内层深度制作画布】双击节点或点击检视器按钮下钻进入全屏制作画布 (LookdevCanvas / StoryboardCanvas)；
 * 4. 【双向平滑退回】内层画布顶部统配「← 返回流向拓扑」面包屑导航，随时一键返回；
 * 5. 【高清放大灯箱】MediaLightboxModal 全局常驻支持全屏原图与视听原片播放。
 */

import React, { useState, useMemo } from 'react';
import type { ProjectData, TaskRecord } from '../../../types/index.js';
import { VisualPipelineTopology, type TopoNode } from './visual/VisualPipelineTopology.js';
import { VisualInspectorPanel } from './visual/VisualInspectorPanel.js';
import { LookdevCanvas } from './visual/LookdevCanvas.js';
import { StoryboardCanvas } from '../canvas/StoryboardCanvas.js';
import { DirectorFloatingBubble } from '../chat/DirectorFloatingBubble.js';
import { MediaLightboxModal, type MediaLightboxItem } from './visual/MediaLightboxModal.js';
import { type SubCanvasOption } from '../canvas/SubCanvasSwitcher.js';

interface VisualStageProps {
  projectId: string;
  projectData: ProjectData | null;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
  isBusy: boolean;
}

export const VisualStage: React.FC<VisualStageProps> = ({
  projectId,
  projectData,
  tasks = [],
  onRunTool,
  onRefreshProject,
  isBusy,
}) => {
  // 当前子制作画布状态：null (主拓扑) | { mode: 'lookdev' } | { mode: 'clip'; clipId: string; clipTitle: string }
  const [subCanvas, setSubCanvas] = useState<
    | { mode: 'lookdev' }
    | { mode: 'clip'; clipId: string; clipTitle: string }
    | null
  >(null);

  // 右侧轻量检视器当前选中的节点
  const [inspectingNode, setInspectingNode] = useState<TopoNode | null>(null);

  // 视听高清放大灯箱状态
  const [enlargedMedia, setEnlargedMedia] = useState<{
    title: string;
    imageUrl?: string;
    videoUrl?: string;
    badge?: string;
    subtitle?: string;
    gallery?: MediaLightboxItem[];
  } | null>(null);

  // 计算当前项目所有的平行子画布清单 (SSOT)
  const subCanvasOptions = useMemo<SubCanvasOption[]>(() => {
    const list: SubCanvasOption[] = [];

    // 1. 全剧视觉定妆母体
    const entities =
      projectData?.artifacts?.lookdev_entities ||
      (projectData as any)?.entities ||
      {};
    const chars = Array.isArray(entities.characters) ? entities.characters : [];
    const locs = Array.isArray(entities.locations) ? entities.locations : [];
    const items = Array.isArray(entities.items) ? entities.items : [];
    const completedChars = chars.filter((c: any) => Boolean(c.imageUrl)).length;
    const completedLocs = locs.filter((l: any) => Boolean(l.imageUrl)).length;
    const completedItems = items.filter((i: any) => Boolean(i.imageUrl)).length;
    const totalAssets = chars.length + locs.length + items.length;
    const completedAssets = completedChars + completedLocs + completedItems;

    list.push({
      id: 'lookdev',
      mode: 'lookdev',
      title: '全剧视觉定妆工坊',
      badge: totalAssets > 0 ? `${completedAssets}/${totalAssets}` : undefined,
    });

    // 2. 收集所有分幕切片 (基于结构化剧本 screenplayJson / storyboards / film_spec)
    const prdClips =
      projectData?.screenplayJson?.clips ||
      projectData?.artifacts?.screenplay_json?.clips ||
      [];
    const rawStoryboards =
      projectData?.storyboards ||
      projectData?.artifacts?.storyboards ||
      [];
    const filmSpecClips =
      projectData?.artifacts?.film_spec?.clips ||
      [];

    const clipMap = new Map<string, { id: string; title: string; shots: any[] }>();

    for (const c of prdClips) {
      if (c && c.id) {
        clipMap.set(c.id, {
          id: c.id,
          title: c.title || c.name || `第 ${c.id} 幕`,
          shots: [],
        });
      }
    }

    const allClipSources = [rawStoryboards, filmSpecClips];
    for (const source of allClipSources) {
      if (!Array.isArray(source)) continue;
      for (const item of source) {
        if (!item) continue;
        const cid = item.clipId || item.id || item.sourceNodeId;
        if (!cid) continue;
        const existing = clipMap.get(cid);
        const itemShots = Array.isArray(item.shots) ? item.shots : [];
        if (existing) {
          if (itemShots.length > 0 && existing.shots.length === 0) {
            existing.shots = itemShots;
          }
          if (!existing.title && item.title) existing.title = item.title;
        } else {
          clipMap.set(cid, {
            id: cid,
            title: item.title || `第 ${cid} 幕`,
            shots: itemShots,
          });
        }
      }
    }

    const wiring =
      projectData?.artifacts?.prd?.wiring ||
      (projectData?.storyGraph?.edges || [])
        .filter((e: any) => e.edgeType === 'MAINLINE_PROGRESS')
        .map((e: any) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId })) ||
      [];

    const clipsList = Array.from(clipMap.values());
    const progressMap = new Map<string, { totalShots: number; completedVideos: number; isAllVideosCompleted: boolean }>();
    for (const clip of clipsList) {
      const shots = clip.shots || [];
      const totalShots = shots.length;
      const completedVideos = shots.filter((s: any) => Boolean(s.videoUrl)).length;
      progressMap.set(clip.id, {
        totalShots,
        completedVideos,
        isAllVideosCompleted: totalShots > 0 && completedVideos === totalShots,
      });
    }

    clipsList.forEach((clip, index) => {
      const progress = progressMap.get(clip.id)!;
      const isRoot = index === 0 || clip.id === 'c1' || clip.id === 'clip_1';

      // 查找前驱父分幕
      const parentWire = wiring.find((w: any) => w.targetClipId === clip.id || w.toNodeId === clip.id);
      const parentId = parentWire ? (parentWire.sourceClipId || parentWire.fromNodeId) : (index > 0 ? clipsList[index - 1].id : null);
      const parentProgress = parentId ? progressMap.get(parentId) : null;
      const parentAllDone = parentProgress ? parentProgress.isAllVideosCompleted : false;

      // 解锁门禁：根分幕直接解锁；下游分幕若前驱全部成片、或自身已有有效进度，则解锁
      const isUnlocked = isRoot || parentAllDone || progress.completedVideos > 0;

      list.push({
        id: clip.id,
        mode: 'clip',
        title: clip.title,
        totalShots: progress.totalShots > 0 ? progress.totalShots : undefined,
        completedVideos: progress.totalShots > 0 ? progress.completedVideos : undefined,
        badge: progress.totalShots > 0 ? `${progress.completedVideos}/${progress.totalShots} 镜` : undefined,
        isPlanned: progress.totalShots > 0,
        isUnlocked,
      });
    });

    return list;
  }, [projectData]);

  // 响应下钻进入子画布
  const handleEnterSubCanvas = (
    kind: 'lookdev' | 'clip',
    clipId?: string,
    clipTitle?: string
  ) => {
    if (kind === 'lookdev') {
      setSubCanvas({ mode: 'lookdev' });
    } else if (clipId) {
      setSubCanvas({
        mode: 'clip',
        clipId,
        clipTitle: clipTitle || '本幕分镜台本',
      });
    }
  };

  // 响应平行子画布之间快捷切换
  const handleSwitchSubCanvas = (option: SubCanvasOption) => {
    if (option.mode === 'lookdev') {
      setSubCanvas({ mode: 'lookdev' });
    } else {
      setSubCanvas({
        mode: 'clip',
        clipId: option.id,
        clipTitle: option.title,
      });
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {/* 1. 深度制作分支 A：全剧视觉定妆专属制作画布 */}
      {subCanvas?.mode === 'lookdev' && (
        <LookdevCanvas
          projectId={projectId}
          projectData={projectData}
          tasks={tasks}
          onRunTool={onRunTool}
          onRefreshProject={onRefreshProject}
          onBackToTopology={() => setSubCanvas(null)}
          onEnlargeMedia={setEnlargedMedia}
          subCanvasOptions={subCanvasOptions}
          onSwitchSubCanvas={handleSwitchSubCanvas}
          isBusy={isBusy}
        />
      )}

      {/* 2. 深度制作分支 B：单幕视听分镜台本制作画布 */}
      {subCanvas?.mode === 'clip' && (
        <>
          <StoryboardCanvas
            projectId={projectId}
            clipId={subCanvas.clipId}
            clipTitle={subCanvas.clipTitle}
            projectData={projectData}
            tasks={tasks}
            onRunTool={onRunTool}
            onRefreshProject={onRefreshProject}
            onBackToTopology={() => setSubCanvas(null)}
            onEnlargeMedia={setEnlargedMedia}
            subCanvasOptions={subCanvasOptions}
            onSwitchSubCanvas={handleSwitchSubCanvas}
            isBusy={isBusy}
          />
          <DirectorFloatingBubble
            mode="storyboard"
            clipId={subCanvas.clipId}
            clipTitle={subCanvas.clipTitle}
            projectId={projectId}
            tasks={tasks}
            onRefreshProject={onRefreshProject}
          />
        </>
      )}

      {/* 3. 宏观主视区：视听制作流向拓扑图 + 右侧轻量检视面板 */}
      {!subCanvas && (
        <>
          <VisualPipelineTopology
            projectData={projectData}
            tasks={tasks}
            selectedNodeId={inspectingNode?.id}
            onSelectNode={(node) => setInspectingNode(node)}
            onEnterSubCanvas={handleEnterSubCanvas}
            onEnlargeClip={setEnlargedMedia}
          />

          {/* 右侧轻量只读检视面板 (单击节点开启，无全屏暗黑遮罩阻隔) */}
          {inspectingNode && (
            <VisualInspectorPanel
              node={inspectingNode}
              projectData={projectData}
              onClose={() => setInspectingNode(null)}
              onEnterCanvas={handleEnterSubCanvas}
              onEnlargeMedia={setEnlargedMedia}
              onRefreshProject={onRefreshProject}
            />
          )}
        </>
      )}

      {/* 视听高清放大灯箱弹窗 */}
      {enlargedMedia && (
        <MediaLightboxModal
          title={enlargedMedia.title}
          imageUrl={enlargedMedia.imageUrl}
          videoUrl={enlargedMedia.videoUrl}
          badge={enlargedMedia.badge}
          subtitle={enlargedMedia.subtitle}
          gallery={enlargedMedia.gallery}
          onClose={() => setEnlargedMedia(null)}
        />
      )}
    </div>
  );
};
