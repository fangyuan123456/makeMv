/**
 * client/src/components/studio/stages/VisualStage.tsx
 * 工序 2：视听制作工坊根组件 (Visual Stage SSOT)
 *
 * 核心架构机制：
 * 1. 【宏观拓扑主画布】默认展示视听制作流向拓扑图 (VisualPipelineTopology)；
 * 2. 【轻量右侧检视器】单击节点展示 VisualInspectorPanel (看剧本文本、直接播放视频、预览定妆，不可修改，零遮罩阻隔)；
 * 3. 【内层深度制作画布】双击节点或点击检视器按钮下钻进入全屏制作画布 (LookdevCanvas / ClipStoryboardCanvas)；
 * 4. 【双向平滑退回】内层画布顶部统配「← 返回流向拓扑」面包屑导航，随时一键返回；
 * 5. 【高清放大灯箱】MediaLightboxModal 全局常驻支持全屏原图与视听原片播放。
 */

import React, { useState } from 'react';
import type { ProjectData, TaskRecord } from '../../../types/index.js';
import { VisualPipelineTopology, type TopoNode } from './visual/VisualPipelineTopology.js';
import { VisualInspectorPanel } from './visual/VisualInspectorPanel.js';
import { LookdevCanvas } from './visual/LookdevCanvas.js';
import { ClipStoryboardCanvas } from './visual/ClipStoryboardCanvas.js';
import { MediaLightboxModal } from './visual/MediaLightboxModal.js';

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
  } | null>(null);

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
          isBusy={isBusy}
        />
      )}

      {/* 2. 深度制作分支 B：单幕视听分镜台本制作画布 */}
      {subCanvas?.mode === 'clip' && (
        <ClipStoryboardCanvas
          projectId={projectId}
          clipId={subCanvas.clipId}
          clipTitle={subCanvas.clipTitle}
          projectData={projectData}
          tasks={tasks}
          onRunTool={onRunTool}
          onRefreshProject={onRefreshProject}
          onBackToTopology={() => setSubCanvas(null)}
          onEnlargeMedia={setEnlargedMedia}
          isBusy={isBusy}
        />
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
          onClose={() => setEnlargedMedia(null)}
        />
      )}
    </div>
  );
};
