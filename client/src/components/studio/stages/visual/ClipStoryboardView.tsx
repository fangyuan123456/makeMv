/**
 * client/src/components/studio/stages/visual/ClipStoryboardView.tsx
 * 工序 2：单幕专属视听分镜台本工作台 (Clip Storyboard Studio View)
 *
 * 核心机制：
 * 1. 首次进入若未规划分镜，自动呈现沉浸式推演加载并调用 film.storyboard_planning；
 * 2. 规划完成后呈现各镜头卡片 (景别、运镜、台词、画面描述、关键帧生图)；
 * 3. 顶部常驻【⬅️ 返回制作拓扑图】面包屑导航。
 */

import React, { useEffect } from 'react';
import type { ProjectData, TaskRecord, CinematicShotOrder } from '../../../../types/index.js';
import { isEntityTaskRunning } from '../../../../lib/taskUtils.js';

export interface ClipStoryboardViewProps {
  projectId: string;
  clipId: string;
  clipTitle: string;
  projectData: ProjectData | null;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
  onBackToTopology: () => void;
}

export const ClipStoryboardView: React.FC<ClipStoryboardViewProps> = ({
  projectId,
  clipId,
  clipTitle,
  projectData,
  tasks = [],
  onRunTool,
  onRefreshProject,
  onBackToTopology,
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

  // 兼容打平数组或 clips 嵌套
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
      console.log(`[ClipStoryboardView] 首次进入【${clipTitle}】，自动启动分镜规划推演...`);
      onRunTool('film.storyboard_planning', {
        projectId,
        clipId,
      }).then(() => {
        onRefreshProject?.();
      }).catch((err) => {
        console.warn('[ClipStoryboardView] 自动推演分镜失败:', err);
      });
    }
  }, [clipId, shots.length, isPlanningStoryboard]);

  // 5. 手动重新推演分镜
  const handleReplanStoryboard = async () => {
    if (!window.confirm(`确定重新推演【${clipTitle}】的分镜台本吗？已有镜头设定将被更新。`)) return;
    await onRunTool('film.storyboard_planning', {
      projectId,
      clipId,
      force: true,
    });
    onRefreshProject?.();
  };

  // 6. 生成单个镜头的关键帧
  const handleGenerateKeyframe = async (shot: CinematicShotOrder) => {
    try {
      await onRunTool('film.shot_keyframe', {
        projectId,
        shotId: shot.shotId,
        clipId,
        prompt: shot.firstFramePrompt || shot.videoPrompt || shot.promptZh || '',
        referenceImageUrls: shot.characterReferenceImageUrls,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`关键帧生图失败: ${err.message}`);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto bg-slate-50/70 select-none">
      {/* 顶部面包屑与操作栏 */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 mb-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToTopology}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer flex items-center space-x-1"
          >
            <span>⬅️ 返回制作拓扑图</span>
          </button>
          <span className="text-slate-300">/</span>
          <div className="flex items-center space-x-2">
            <span className="text-lg">🎬</span>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              【{clipTitle}】分镜台本与镜头制作
            </h2>
            <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
              {clipId}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={handleReplanStoryboard}
            disabled={isPlanningStoryboard}
            className="px-3.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-2xs transition disabled:opacity-50 cursor-pointer"
          >
            {isPlanningStoryboard ? '⏳ 正在推演分镜中...' : '🔄 重新推演本幕分镜'}
          </button>
        </div>
      </div>

      {/* 剧情大纲卡片 */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 mb-6 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
            <span>📖</span>
            <span>本幕剧本剧情段落</span>
          </span>
          <span className="text-[11px] text-slate-400">单幕视听基底</span>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed font-sans bg-slate-50 p-3.5 rounded-xl border border-slate-200/70 whitespace-pre-wrap">
          {narrativeText}
        </p>
      </div>

      {/* 首次加载状态：正在规划分镜 */}
      {isPlanningStoryboard && (
        <div className="flex-1 flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-dashed border-indigo-200 shadow-xs text-center space-y-4">
          <div className="relative mb-2">
            <div className="w-16 h-16 rounded-full border-3 border-indigo-400/40 animate-ping absolute" />
            <div className="w-16 h-16 rounded-full border-3 border-indigo-200 border-t-indigo-600 animate-spin" />
            <span className="absolute inset-0 flex items-center justify-center text-2xl">🎬</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              正在推演拆解【{clipTitle}】视听分镜台本...
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
              AI 视听总导演正在分析剧情冲突、计算最佳视听景别、设计运镜流向并规划各镜头的生图提示词
            </p>
          </div>
          <div className="w-48 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2">
            <div className="w-full h-full bg-gradient-to-r from-transparent via-indigo-600 to-transparent animate-pulse" />
          </div>
        </div>
      )}

      {/* 镜头台本卡片列表 */}
      {!isPlanningStoryboard && shots.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-dashed border-slate-200 shadow-xs text-center space-y-3">
          <span className="text-4xl opacity-50">🎬</span>
          <p className="text-xs text-slate-500 font-medium">
            尚未规划本幕分镜台本，点击上方「重新推演本幕分镜」即可启动自动拆解
          </p>
        </div>
      )}

      {!isPlanningStoryboard && shots.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h3 className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
              <span>🎞️</span>
              <span>拆解镜头序列 (共 {shots.length} 个镜头)</span>
            </h3>
            <span className="text-[11px] text-slate-400">
              各镜头景别、运镜、台词与关键帧
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
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
                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col shadow-xs hover:shadow-md transition-all group"
                >
                  {/* 关键帧立绘展示区 */}
                  <div className="w-full aspect-video bg-slate-100 relative flex items-center justify-center overflow-hidden border-b border-slate-100">
                    {hasKeyframe ? (
                      <img
                        src={shot.firstFrameImageUrl || shot.keyframeUrl}
                        alt={`Shot ${idx + 1}`}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-400 space-y-1">
                        <span className="text-3xl opacity-50">🖼️</span>
                        <span className="text-xs font-semibold">待生成关键帧</span>
                      </div>
                    )}

                    {/* 镜头编号与景别胶囊 */}
                    <div className="absolute top-2.5 left-2.5 flex items-center space-x-1.5">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-900/80 text-white backdrop-blur-md shadow-xs">
                        Shot {idx + 1}
                      </span>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-600/90 text-white backdrop-blur-md shadow-xs">
                        {shot.shotType || '中景'}
                      </span>
                    </div>

                    {/* 时长胶囊 */}
                    <div className="absolute top-2.5 right-2.5">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold bg-white/90 text-slate-700 backdrop-blur-xs border border-slate-200 shadow-2xs">
                        {shot.durationSec || 4.0}s
                      </span>
                    </div>
                  </div>

                  {/* 镜头信息与属性 */}
                  <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      {/* 运镜与人物 */}
                      <div className="flex items-center space-x-2 mb-2 text-xs">
                        <span className="font-bold text-slate-800">
                          🎥 {shot.cameraMovement || '固定镜头'}
                        </span>
                        {shot.characterName && (
                          <span className="text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 text-[11px]">
                            👤 {shot.characterName}
                          </span>
                        )}
                      </div>

                      {/* 台词与对白 */}
                      {shot.dialogue && (
                        <div className="p-2.5 bg-amber-50/60 rounded-xl border border-amber-200/60 mb-2.5">
                          <span className="text-[10px] font-bold text-amber-800 block mb-0.5">
                            💬 台词对白
                          </span>
                          <p className="text-xs text-amber-900 leading-relaxed italic">
                            “{shot.dialogue}”
                          </p>
                        </div>
                      )}

                      {/* 画面提示词 */}
                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/80">
                        <span className="text-[10px] font-bold text-slate-600 block mb-0.5">
                          🎨 画面提示词
                        </span>
                        <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 font-mono">
                          {shot.firstFramePrompt || shot.videoPrompt || shot.promptZh || '暂无详细生图提示词'}
                        </p>
                      </div>
                    </div>

                    {/* 关键帧生成按钮 */}
                    <div className="pt-2">
                      <button
                        onClick={() => handleGenerateKeyframe(shot)}
                        disabled={isGeneratingThis}
                        className={`w-full py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer flex items-center justify-center space-x-1 ${
                          isGeneratingThis
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-600 opacity-80 cursor-wait'
                            : hasKeyframe
                            ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 shadow-2xs'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white border-transparent shadow-xs'
                        }`}
                      >
                        <span>
                          {isGeneratingThis
                            ? '⏳ 正在渲染关键帧...'
                            : hasKeyframe
                            ? '🔄 重新渲染关键帧'
                            : '🎨 生成关键帧'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
