/**
 * client/src/components/studio/stages/visual/ClipStoryboardDrawer.tsx
 * 单幕视听分镜台本与镜头制作右侧滑出抽屉 (Clip Storyboard Drawer SSOT)
 *
 * 核心机制：
 * 1. 右侧滑出常驻，主拓扑画布无需切换页面；
 * 2. 首次进入若无分镜，自动呈现流光加载推演并调用 film.storyboard_planning；
 * 3. 规划完成后完整呈现单幕剧情大纲、镜头列表、景别、运镜、台词、关键帧生成与提示词修改。
 */

import React, { useEffect } from 'react';
import type { ProjectData, TaskRecord, CinematicShotOrder } from '../../../../types/index.js';
import { isEntityTaskRunning } from '../../../../lib/taskUtils.js';

export interface ClipStoryboardDrawerProps {
  projectId: string;
  clipId: string;
  clipTitle: string;
  projectData: ProjectData | null;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
  onClose: () => void;
  onOpenFullscreen?: () => void;
  isBusy?: boolean;
}

export const ClipStoryboardDrawer: React.FC<ClipStoryboardDrawerProps> = ({
  projectId,
  clipId,
  clipTitle,
  projectData,
  tasks = [],
  onRunTool,
  onRefreshProject,
  onClose,
  onOpenFullscreen,
  isBusy,
}) => {
  // 1. 获取当前幕的剧情大纲
  const prd = projectData?.prd || projectData?.artifacts?.gdd?.prd;
  const currentClip = (prd?.clips || []).find((c: any) => c.id === clipId);
  const narrativeText =
    currentClip?.narrativeText ||
    projectData?.storySections?.[clipId]?.narrativeText ||
    '暂无剧情段落描述';

  // 2. 提取当前幕的分镜镜头列表
  const rawStoryboards =
    projectData?.storyboards || projectData?.artifacts?.storyboards || [];
  const filmSpec = projectData?.artifacts?.film_spec;

  let shots: CinematicShotOrder[] = [];
  if (Array.isArray(rawStoryboards) && rawStoryboards.length > 0) {
    const matchedClip = rawStoryboards.find(
      (item: any) =>
        item.clipId === clipId ||
        item.id === clipId ||
        item.sourceNodeId === clipId ||
        item.clipId === `c${clipId.replace(/\D/g, '')}`
    );
    if (matchedClip && Array.isArray(matchedClip.shots)) {
      shots = matchedClip.shots;
    } else {
      shots = rawStoryboards.filter(
        (s: any) => s.clipId === clipId || s.sourceNodeId === clipId
      );
    }
  }

  if (shots.length === 0 && filmSpec?.clips) {
    const matched = filmSpec.clips.find(
      (c: any) =>
        c.clipId === clipId ||
        c.sourceNodeId === clipId ||
        c.clipId === `c${clipId.replace(/\D/g, '')}`
    );
    if (matched?.shots) shots = matched.shots;
  }

  // 3. 判断是否正在规划分镜
  const isPlanningStoryboard = tasks.some(
    (t) =>
      (t.status === 'running' || t.status === 'pending') &&
      t.toolName === 'film.storyboard_planning'
  );

  // 4. 首次进入自动推演：若当前幕未规划分镜且无正在运行的任务，自动触发
  useEffect(() => {
    if (shots.length === 0 && !isPlanningStoryboard) {
      console.log(`[ClipStoryboardDrawer] 首次打开【${clipTitle}】，自动启动分镜规划推演...`);
      onRunTool('film.storyboard_planning', {
        projectId,
        clipId,
      }).then(() => {
        onRefreshProject?.();
      }).catch((err) => {
        console.warn('[ClipStoryboardDrawer] 自动推演分镜失败:', err);
      });
    }
  }, [clipId, shots.length, isPlanningStoryboard]);

  // 手动重新推演分镜
  const handleReplanStoryboard = async () => {
    if (!window.confirm(`确定重新推演【${clipTitle}】的分镜台本吗？已有镜头设定将被更新。`)) return;
    await onRunTool('film.storyboard_planning', {
      projectId,
      clipId,
      force: true,
    });
    onRefreshProject?.();
  };

  // 生成单个镜头的关键帧
  const handleGenerateKeyframe = async (shot: CinematicShotOrder) => {
    try {
      await onRunTool('film.shot_keyframe', {
        projectId,
        shotId: shot.shotId,
        clipId,
        prompt: shot.firstFramePrompt || shot.videoPrompt || (shot as any).promptZh || '',
        referenceImageUrls: shot.characterReferenceImageUrls,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`关键帧生图失败: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[640px] max-w-[95vw] bg-white shadow-2xl z-40 border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-250 select-none">
      {/* 顶部标题栏与关闭按钮 */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80 flex-shrink-0">
        <div className="flex items-center space-x-2.5">
          <span className="text-xl">🎬</span>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                【{clipTitle}】分镜台本与制作
              </h3>
              <span className="text-[10px] font-mono text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                {clipId}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              单幕视听拆解 · 景别运镜台词设计与关键帧画面渲染
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {onOpenFullscreen && (
            <button
              onClick={onOpenFullscreen}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center space-x-1 shadow-2xs transition cursor-pointer"
              title="进入全屏分镜台本制作工坊 (双击节点亦可进入)"
            >
              <span>⛶</span>
              <span>全屏工坊</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer text-base font-bold"
            title="关闭抽屉"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 顶部操作工具条 */}
      <div className="p-3 bg-white border-b border-slate-100 flex items-center justify-between gap-2 flex-shrink-0">
        <span className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
          <span>🎞️</span>
          <span>镜头清单 (共 {shots.length} 镜)</span>
        </span>
        <button
          onClick={handleReplanStoryboard}
          disabled={isPlanningStoryboard}
          className="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-2xs transition disabled:opacity-50 cursor-pointer"
        >
          {isPlanningStoryboard ? '⏳ 正在推演分镜...' : '🔄 重新推演本幕分镜'}
        </button>
      </div>

      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/60">
        {/* 单幕剧本大纲卡片 */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-800 flex items-center space-x-1">
              <span>📖</span>
              <span>本幕剧情大纲</span>
            </span>
            <span className="text-[10px] text-slate-400">单幕视听母本</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed font-sans bg-slate-50 p-3 rounded-xl border border-slate-100 whitespace-pre-wrap">
            {narrativeText}
          </p>
        </div>

        {/* 正在规划加载动效 */}
        {isPlanningStoryboard && (
          <div className="py-16 flex flex-col items-center justify-center p-8 bg-white rounded-2xl border border-dashed border-indigo-200 shadow-xs text-center space-y-3">
            <div className="relative mb-2">
              <div className="w-14 h-14 rounded-full border-3 border-indigo-400/40 animate-ping absolute" />
              <div className="w-14 h-14 rounded-full border-3 border-indigo-200 border-t-indigo-600 animate-spin" />
              <span className="absolute inset-0 flex items-center justify-center text-xl">🎬</span>
            </div>
            <h4 className="text-sm font-bold text-slate-900">
              正在推演拆解【{clipTitle}】分镜台本...
            </h4>
            <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
              AI 视听总导演正在分析剧情冲突、计算最佳视听景别与设计运镜流向
            </p>
          </div>
        )}

        {/* 镜头列表 */}
        {!isPlanningStoryboard && shots.length === 0 && (
          <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-200 p-8 shadow-xs">
            <span className="text-3xl block mb-2 opacity-50">🎬</span>
            <p className="text-xs text-slate-500 font-medium">尚未规划本幕分镜，点击上方「重新推演」启动自动拆解</p>
          </div>
        )}

        {!isPlanningStoryboard && shots.length > 0 && (
          <div className="space-y-4">
            {shots.map((shot, idx) => {
              const hasKeyframe = Boolean(shot.firstFrameImageUrl || shot.keyframeUrl);
              const isGeneratingThis = isEntityTaskRunning(
                tasks,
                ['film.shot_keyframe', 'film.keyframe_generate'],
                { shotId: shot.shotId, id: shot.shotId }
              );

              return (
                <div
                  key={shot.shotId || idx}
                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:border-indigo-200 transition"
                >
                  {/* 16:9 关键帧与视频画面预览区 */}
                  <div className="w-full aspect-video bg-slate-900 relative flex items-center justify-center overflow-hidden border-b border-slate-100">
                    {hasKeyframe ? (
                      <img
                        src={shot.firstFrameImageUrl || shot.keyframeUrl}
                        alt={`Shot ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-400 space-y-1">
                        <span className="text-3xl opacity-40">🖼️</span>
                        <span className="text-xs font-semibold text-slate-300">待生成关键帧画面</span>
                      </div>
                    )}

                    {/* 镜头编号与景别 */}
                    <div className="absolute top-2.5 left-2.5 flex items-center space-x-1.5 z-20">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-900/80 text-white backdrop-blur-md">
                        Shot {idx + 1}
                      </span>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-600/90 text-white backdrop-blur-md">
                        {shot.shotType || '中景'}
                      </span>
                      {hasKeyframe && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/80 text-white backdrop-blur-md">
                          AI生成
                        </span>
                      )}
                    </div>

                    {/* 运镜与时长 */}
                    <div className="absolute top-2.5 right-2.5 flex items-center space-x-1 z-20">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-medium bg-black/60 text-slate-200 backdrop-blur-md">
                        {shot.cameraMovement || '固定机位'}
                      </span>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold bg-black/60 text-slate-200 backdrop-blur-md">
                        {shot.durationSec || 4.0}s
                      </span>
                    </div>

                    {/* 生成中动态遮罩 */}
                    {isGeneratingThis && (
                      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-xs flex flex-col items-center justify-center text-white z-30">
                        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mb-2" />
                        <span className="text-xs font-bold">正在渲染关键帧画面...</span>
                      </div>
                    )}
                  </div>

                  {/* 镜头台词与描述控制区 */}
                  <div className="p-4 space-y-3">
                    {/* 台词与对白 */}
                    {shot.dialogue && (
                      <div className="p-2.5 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs text-indigo-950 font-medium">
                        <span className="text-indigo-600 font-bold mr-1">💬 台词/对白:</span>
                        <span>{shot.dialogue}</span>
                      </div>
                    )}

                    {/* 画面生图描述词 */}
                    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      <div className="text-[11px] font-bold text-slate-700 mb-1 flex items-center justify-between">
                        <span>🎨 关键帧画面提示词</span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed font-sans">
                        {shot.firstFramePrompt || shot.videoPrompt || (shot as any).promptZh || '暂无详细描述'}
                      </p>
                    </div>

                    {/* 底部生成按钮 */}
                    <div className="flex items-center justify-end pt-1">
                      <button
                        onClick={() => handleGenerateKeyframe(shot)}
                        disabled={isGeneratingThis || isBusy}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-2xs transition cursor-pointer disabled:opacity-50 flex items-center space-x-1"
                      >
                        <span>{hasKeyframe ? '🔄 重新生成关键帧' : '✨ 生成首帧关键帧'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
