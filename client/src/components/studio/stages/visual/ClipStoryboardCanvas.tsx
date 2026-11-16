/**
 * client/src/components/studio/stages/visual/ClipStoryboardCanvas.tsx
 * 单幕视听分镜台本与镜头制作专属画布 (Clip Storyboard Inner Canvas SSOT)
 *
 * 核心机制：
 * 1. 【开阔镜头台本画布】独立全屏展示本幕分镜时间序列流 (Shot Sequence Flow)；
 * 2. 【双向导航】顶部具备「← 返回流向拓扑」面包屑，随时无缝退回拓扑总览；
 * 3. 【完整镜头推演与生图】景别、机位运镜、台词、提示词修改保存与单镜生图；
 * 4. 【视听沉浸】关键帧大图支持一键放大到灯箱查看。
 */

import React, { useEffect, useState } from 'react';
import type { ProjectData, TaskRecord } from '../../../../types/index.js';
import { updateEntity } from '../../../../lib/api.js';
import { DirectorFloatingBubble } from '../../chat/DirectorFloatingBubble.js';

export interface StoryboardShotItem {
  id?: string;
  shotId?: string;
  shotIndex?: number;
  durationSec?: number;
  duration?: number;
  shotType?: string;
  shotSize?: string;
  cameraMovement?: string;
  firstFrameImageUrl?: string;
  keyframeUrl?: string;
  imageUrl?: string;
  dialogue?: string;
  narration?: string;
  promptZh?: string;
  visualPromptZh?: string;
  firstFramePrompt?: string;
  videoPrompt?: string;
  [key: string]: any;
}

export interface ClipStoryboardCanvasProps {
  projectId: string;
  clipId: string;
  clipTitle: string;
  projectData: ProjectData | null;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
  onBackToTopology: () => void;
  onEnlargeMedia?: (media: { title: string; imageUrl?: string; videoUrl?: string }) => void;
  isBusy?: boolean;
}

export const ClipStoryboardCanvas: React.FC<ClipStoryboardCanvasProps> = ({
  projectId,
  clipId,
  clipTitle,
  projectData,
  tasks = [],
  onRunTool,
  onRefreshProject,
  onBackToTopology,
  onEnlargeMedia,
  isBusy,
}) => {
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [shotPromptDrafts, setShotPromptDrafts] = useState<Record<string, string>>({});
  const [showNarrativeSummary, setShowNarrativeSummary] = useState<boolean>(true);

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

  let shots: StoryboardShotItem[] = [];
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
      console.log(`[ClipStoryboardCanvas] 首次打开【${clipTitle}】，自动启动分镜规划推演...`);
      onRunTool('film.storyboard_planning', {
        projectId,
        clipId,
      })
        .then(() => onRefreshProject?.())
        .catch((err) => console.warn('[ClipStoryboardCanvas] 自动推演分镜失败:', err));
    }
  }, [clipId, shots.length, isPlanningStoryboard]);

  // 判断指定镜头是否正在生图
  const isShotGenerating = (shotId?: string): boolean => {
    if (!shotId) return false;
    return tasks.some((t) => {
      if (t.status !== 'running' && t.status !== 'pending') return false;
      if (t.toolName !== 'film.keyframe_generate') return false;
      return t.input?.shotId === shotId;
    });
  };

  // 手动重新触发整幕分镜规划
  const handleReplanStoryboard = async () => {
    try {
      await onRunTool('film.storyboard_planning', {
        projectId,
        clipId,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`分镜规划失败: ${err.message || String(err)}`);
    }
  };

  // 触发单个镜头的关键帧生成
  const handleGenerateKeyframe = async (shot: StoryboardShotItem) => {
    const shotId = shot.shotId || shot.id;
    try {
      await onRunTool('film.keyframe_generate', {
        projectId,
        clipId,
        shotId,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`关键帧生图失败: ${err.message || String(err)}`);
    }
  };

  // 批量为所有镜头生成关键帧
  const handleBatchGenerateKeyframes = async () => {
    try {
      for (const shot of shots) {
        const shotImg = shot.imageUrl || shot.keyframeUrl || shot.firstFrameImageUrl;
        const shotId = shot.shotId || shot.id;
        if (!shotImg && shotId) {
          onRunTool('film.keyframe_generate', {
            projectId,
            clipId,
            shotId,
          });
        }
      }
      onRefreshProject?.();
    } catch (err: any) {
      alert(`批量生成关键帧失败: ${err.message || String(err)}`);
    }
  };

  // 保存单镜头提示词修改
  const handleSaveShotPrompt = async (shotId: string) => {
    const draft = shotPromptDrafts[shotId];
    if (draft === undefined) {
      setEditingShotId(null);
      return;
    }
    try {
      await updateEntity(projectId, 'character' as any, shotId, {
        promptZh: draft,
      });
      onRefreshProject?.();
      setEditingShotId(null);
    } catch (err: any) {
      alert(`保存镜头提示词失败: ${err.message || String(err)}`);
    }
  };

  const completedKeyframeCount = shots.filter(
    (s) => Boolean(s.imageUrl || s.keyframeUrl || s.firstFrameImageUrl)
  ).length;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#f8fafc] overflow-hidden select-none animate-in fade-in duration-200">
      {/* 优雅浅色底网格点阵 */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-60">
        <defs>
          <pattern id="clip_dot_grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.2" fill="#cbd5e1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#clip_dot_grid)" />
      </svg>

      {/* ──────────────── 1. 顶部视听导航栏 ──────────────── */}
      <header className="relative z-10 px-8 py-4 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBackToTopology}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100/80 text-xs font-bold text-slate-700 flex items-center space-x-2 transition-all shadow-2xs hover:shadow-xs active:scale-95"
          >
            <span>←</span>
            <span>返回流向拓扑</span>
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🎬</span>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-black text-slate-900 tracking-tight">
                  {clipTitle} · 视听分镜台本
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 border border-indigo-200 text-indigo-700">
                  {completedKeyframeCount}/{shots.length} 镜头关键帧已生成
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                导演视听分镜台本 · 景别运镜台词拆解 · 关键帧高清生图
              </p>
            </div>
          </div>
        </div>

        {/* 顶部右侧：批量关键帧与重新推演 */}
        <div className="flex items-center space-x-3">
          {shots.length > 0 && (
            <button
              onClick={handleBatchGenerateKeyframes}
              disabled={isBusy}
              className="px-3.5 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-xs font-bold text-indigo-700 flex items-center space-x-1.5 transition-all active:scale-95"
            >
              <span>🖼️ 批量生成未就绪关键帧</span>
            </button>
          )}

          <button
            onClick={handleReplanStoryboard}
            disabled={isPlanningStoryboard || isBusy}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs ${
              isPlanningStoryboard || isBusy
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100 active:scale-95'
            }`}
          >
            <span>✨</span>
            <span>{shots.length > 0 ? 'AI 重新推演分镜' : '开始规划分镜台本'}</span>
          </button>
        </div>
      </header>

      {/* ──────────────── 2. 核心内容区 ──────────────── */}
      <main className="relative z-10 flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* 本幕剧情摘要卡片 (可折叠) */}
        <div className="bg-white/90 backdrop-blur-xs border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <span className="text-base">📖</span>
              <h3 className="text-xs font-bold text-slate-900">
                本幕剧情大纲剧本
              </h3>
            </div>
            <button
              onClick={() => setShowNarrativeSummary(!showNarrativeSummary)}
              className="text-[11px] text-slate-400 hover:text-slate-700 font-medium"
            >
              {showNarrativeSummary ? '收起 ▲' : '展开全文 ▼'}
            </button>
          </div>
          {showNarrativeSummary && (
            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap select-text">
              {narrativeText}
            </p>
          )}
        </div>

        {/* 分镜推演中状态 */}
        {isPlanningStoryboard && (
          <div className="p-8 rounded-3xl bg-indigo-50/70 border border-indigo-200 flex flex-col items-center justify-center text-center animate-pulse">
            <span className="text-4xl animate-spin mb-3">🎬</span>
            <div className="text-sm font-bold text-indigo-950">
              AI 视听总导演正在逐镜拆解【{clipTitle}】分镜台本...
            </div>
            <p className="text-indigo-600 text-xs mt-1 max-w-md">
              正在依据故事圣经推演景别（特写/全景）、运镜轨迹、光影色调与对白音频契约
            </p>
          </div>
        )}

        {/* 暂未推演分镜 */}
        {!isPlanningStoryboard && shots.length === 0 && (
          <div className="p-12 rounded-3xl bg-white border border-dashed border-slate-300 flex flex-col items-center justify-center text-center shadow-2xs">
            <span className="text-5xl mb-3">🎞️</span>
            <div className="text-sm font-bold text-slate-800">
              本幕分镜台本尚未推演
            </div>
            <p className="text-xs text-slate-500 mt-1 mb-5 max-w-sm">
              点击下方按钮，由 AI 视听总导演为您智能生成符合专业电影工业标准的逐镜头台本
            </p>
            <button
              onClick={handleReplanStoryboard}
              disabled={isBusy}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-100 flex items-center space-x-2"
            >
              <span>✨ 立即推演本幕分镜台本</span>
            </button>
          </div>
        )}

        {/* 镜头台本流水线卡片展示 (Shot Sequence Flow) */}
        {!isPlanningStoryboard && shots.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {shots.map((shot: StoryboardShotItem, idx) => {
              const shotId = shot.shotId || shot.id || `shot_${idx}`;
              const shotImg = shot.imageUrl || shot.keyframeUrl || shot.firstFrameImageUrl;
              const isGen = isShotGenerating(shotId);
              const isEditing = editingShotId === shotId;
              const currentPrompt =
                shotPromptDrafts[shotId] !== undefined
                  ? shotPromptDrafts[shotId]
                  : shot.visualPromptZh || shot.promptZh || shot.firstFramePrompt || '';
              const shotSize = shot.shotSize || shot.shotType || '中景';
              const shotDuration = shot.durationSec || shot.duration;

              return (
                <div
                  key={shotId}
                  className="bg-white/95 backdrop-blur-xs border border-slate-200/90 hover:border-indigo-300 rounded-3xl p-4 shadow-xs hover:shadow-md transition-all flex flex-col group"
                >
                  {/* 关键帧主图 (16:9 画幅) */}
                  <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 mb-3.5 group/img">
                    {shotImg ? (
                      <img
                        src={shotImg}
                        alt={`镜头 #${idx + 1}`}
                        className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 p-4 text-center">
                        <span className="text-3xl mb-1.5">🎬</span>
                        <span className="text-xs font-semibold text-slate-400">
                          待生成关键帧
                        </span>
                      </div>
                    )}

                    {/* 生成中光效遮罩 */}
                    {isGen && (
                      <div className="absolute inset-0 bg-slate-900/75 backdrop-blur-xs flex flex-col items-center justify-center text-white">
                        <span className="text-2xl animate-spin mb-1.5">⏳</span>
                        <span className="text-xs font-bold">关键帧渲染中...</span>
                      </div>
                    )}

                    {/* 序号胶囊 */}
                    <div className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-lg bg-black/60 backdrop-blur-xs text-white text-[10px] font-mono font-bold">
                      Shot #{idx + 1}
                    </div>

                    {/* 放大查看原图 */}
                    {shotImg && (
                      <button
                        onClick={() =>
                          onEnlargeMedia?.({
                            title: `镜头 #${idx + 1} · 关键帧原图`,
                            imageUrl: shotImg,
                          })
                        }
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-xs text-white opacity-0 group-hover/img:opacity-100 transition-opacity text-xs"
                      >
                        ⛶
                      </button>
                    )}
                  </div>

                  {/* 视听属性徽章 (景别 · 运镜) */}
                  <div className="flex items-center space-x-1.5 mb-2.5 flex-wrap gap-y-1">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 border border-indigo-200 text-indigo-700">
                      {shotSize}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 border border-amber-200 text-amber-700">
                      {shot.cameraMovement || '固定镜头'}
                    </span>
                    {shotDuration && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200">
                        {shotDuration}s
                      </span>
                    )}
                  </div>

                  {/* 旁白台词 */}
                  {(shot.narration || shot.dialogue) && (
                    <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-2.5 mb-2.5 text-xs text-slate-700 flex items-start space-x-1.5">
                      <span className="text-slate-400 shrink-0">💬</span>
                      <p className="line-clamp-2 leading-relaxed">
                        {shot.narration || shot.dialogue}
                      </p>
                    </div>
                  )}

                  {/* 画面生图提示词 */}
                  <div className="flex-1 bg-slate-50 border border-slate-200/70 rounded-xl p-2.5 mb-3 flex flex-col">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold text-slate-700">
                        🎨 关键帧生图提示词
                      </span>
                      {isEditing ? (
                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => handleSaveShotPrompt(shotId)}
                            className="text-[10px] text-indigo-600 font-bold hover:underline"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingShotId(null)}
                            className="text-[10px] text-slate-400 hover:text-slate-600"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingShotId(shotId);
                            setShotPromptDrafts((prev) => ({
                              ...prev,
                              [shotId]: currentPrompt,
                            }));
                          }}
                          className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center space-x-0.5"
                        >
                          <span>✏️ 编辑</span>
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <textarea
                        value={currentPrompt}
                        onChange={(e) =>
                          setShotPromptDrafts((prev) => ({
                            ...prev,
                            [shotId]: e.target.value,
                          }))
                        }
                        rows={3}
                        className="w-full text-xs text-slate-800 bg-white border border-indigo-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                      />
                    ) : (
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 overflow-hidden select-text">
                        {currentPrompt || '暂无详细画面描述'}
                      </p>
                    )}
                  </div>

                  {/* 底部按钮 */}
                  <div className="pt-1 border-t border-slate-100">
                    <button
                      onClick={() => handleGenerateKeyframe(shot)}
                      disabled={isGen || isBusy}
                      className={`w-full py-1.5 rounded-xl text-xs font-bold flex items-center justify-center space-x-1 transition-all ${
                        isGen || isBusy
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 active:scale-95'
                      }`}
                    >
                      <span>✨</span>
                      <span>{shotImg ? '重新生成关键帧' : '生成关键帧'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 本幕视听分镜台本专属 AI 视听执行导演 (StoryboardCopilot) */}
      <DirectorFloatingBubble
        mode="storyboard"
        clipId={clipId}
        clipTitle={clipTitle}
        projectId={projectId}
        projectData={projectData}
        tasks={tasks}
        onRunTool={onRunTool}
        onRefreshProject={onRefreshProject}
        isBusy={!!isBusy}
      />
    </div>
  );
};
