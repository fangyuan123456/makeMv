/**
 * client/src/components/studio/stages/StoryboardStage.tsx
 * 工序 3：视听分镜与动态视频工坊 (Storyboard Studio SSOT)
 *
 * 核心微内核升级：
 * 默认承载类似“即梦”的视听无限画布视图 (StoryboardCanvas)，
 * 兼顾传统紧凑列表视图，实现多候选视频切换与局部单镜头独立渲染。
 */

import React, { useState } from 'react';
import type { ProjectData } from '../../../types/index.js';
import { StoryboardCanvas } from '../canvas/StoryboardCanvas.js';

interface StoryboardStageProps {
  projectId: string;
  projectData: ProjectData | null;
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  isBusy: boolean;
}

export const StoryboardStage: React.FC<StoryboardStageProps> = ({
  projectId,
  projectData,
  onRunTool,
  isBusy,
}) => {
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>('canvas');

  // 提取并打平所有分幕下的镜头列表，兼容两级 clips/shots 结构 (列表模式消费)
  const allShots = React.useMemo(() => {
    const rawClips =
      projectData?.storyboards ||
      projectData?.artifacts?.film_spec?.clips ||
      projectData?.artifacts?.film_spec?.slices ||
      [];

    const list: any[] = [];
    for (const c of rawClips) {
      if (Array.isArray(c.shots) && c.shots.length > 0) {
        for (const s of c.shots) {
          list.push({
            ...s,
            sceneTitle: c.title || c.clipId,
            keyframeUrl: s.firstFrameImageUrl || s.keyframeUrl,
            videoUrl: s.videoUrl || c.videoUrl,
            promptZh: s.firstFramePrompt || s.promptZh || s.description,
          });
        }
      } else {
        list.push({
          ...c,
          keyframeUrl: c.firstFrameImageUrl || c.keyframeUrl,
          videoUrl: c.videoUrl,
          promptZh: c.firstFramePrompt || c.promptZh || c.description,
        });
      }
    }
    return list;
  }, [projectData]);

  const handlePlanStoryboards = async () => {
    await onRunTool('film.shooting_script', {});
  };

  const handleBatchVideos = async () => {
    await onRunTool('film.shot_video', { force: false });
  };

  const handleSingleVideo = async (shotId: string) => {
    await onRunTool('film.shot_video', { shotId, force: true });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶栏：工作流控制与双视图切换 */}
      <div className="bg-white border-b border-slate-200/90 px-6 py-3 flex-shrink-0 flex flex-wrap items-center justify-between gap-4 shadow-2xs z-30">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-lg shadow-2xs">
            🎬
          </div>
          <div>
            <h2 className="text-xs font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>工序 3：视听分镜与视频工坊</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-600 font-semibold border border-indigo-100">
                CANVAS PRO
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              即梦式分镜拓扑画布 · 支持多方案候选视频与镜头级独立渲染
            </p>
          </div>
        </div>

        {/* 视图切换胶囊与工具栏 */}
        <div className="flex items-center space-x-2.5">
          {/* 双视图切换器 */}
          <div className="flex items-center p-1 bg-slate-100/90 rounded-xl border border-slate-200/80 space-x-1 shadow-2xs">
            <button
              onClick={() => setViewMode('canvas')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                viewMode === 'canvas'
                  ? 'bg-white text-indigo-600 shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🎨</span>
              <span>无限画布视图</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                viewMode === 'list'
                  ? 'bg-white text-indigo-600 shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>📋</span>
              <span>列表核对视图</span>
            </button>
          </div>

          {/* 阶段工具派发 */}
          <div className="flex items-center space-x-1.5 pl-2 border-l border-slate-200">
            <button
              onClick={handlePlanStoryboards}
              disabled={isBusy}
              className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 shadow-2xs transition disabled:opacity-50"
            >
              1. 拆解片段
            </button>
            <button
              onClick={handleBatchVideos}
              disabled={isBusy || allShots.length === 0}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition disabled:opacity-50"
            >
              2. 批量视频
            </button>
          </div>
        </div>
      </div>

      {/* 主体视窗：根据视图模式呈现 */}
      <div className="flex-1 overflow-hidden relative">
        {viewMode === 'canvas' ? (
          <StoryboardCanvas
            projectId={projectId}
            projectData={projectData}
            onRunTool={onRunTool}
            isBusy={isBusy}
          />
        ) : (
          <div className="h-full p-6 overflow-y-auto">
            {allShots.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center bg-white border border-dashed border-slate-200 rounded-2xl text-slate-400">
                <span className="text-3xl mb-2">📋</span>
                <p className="text-xs font-medium">尚未拆解任何视听分镜镜头</p>
                <p className="text-[11px] text-slate-400 mt-1">请点击上方“1. 拆解镜头”启动分镜推演</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {allShots.map((shot: any, idx: number) => (
                  <div
                    key={shot.shotId || idx}
                    className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col"
                  >
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800">
                        {shot.shotId || `镜头 #${idx + 1}`}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {shot.durationSec || 4.0}s
                      </span>
                    </div>

                    <div className="relative h-40 bg-slate-900 flex items-center justify-center overflow-hidden">
                      {shot.videoUrl ? (
                        <video
                          src={shot.videoUrl}
                          poster={shot.keyframeUrl}
                          controls
                          className="w-full h-full object-cover"
                        />
                      ) : shot.keyframeUrl ? (
                        <img
                          src={shot.keyframeUrl}
                          alt="首帧"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-slate-500 text-xs">待生成媒体</span>
                      )}
                    </div>

                    <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                      <p className="text-xs text-slate-600 line-clamp-2">
                        {shot.promptZh || shot.firstFramePrompt || '暂无描述'}
                      </p>
                      <div className="flex items-center space-x-1 pt-2 border-t border-slate-100">
                        <button
                          onClick={() => handleSingleVideo(shot.shotId)}
                          disabled={isBusy}
                          className="flex-1 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-medium rounded border border-indigo-200 transition"
                        >
                          渲染视频
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
