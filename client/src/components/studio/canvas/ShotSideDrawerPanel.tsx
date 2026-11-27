/**
 * client/src/components/studio/canvas/ShotSideDrawerPanel.tsx
 * 剧本片段外层侧边抽屉面板 (Flat Inspector & Generation Drawer)
 *
 * 布局规范：
 * 1. 上方固定关键区：视频播映窗、候选版本切换、连续性模式、AI 推演与一键渲染视频；
 * 2. 下方标签切换区：「片段剧本」与「视频提示词」同层切换，无需进入二级子界面。
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { CanvasShotNode, ProjectData, TaskRecord } from '../../../types/index.js';
import type { MediaLightboxItem } from '../stages/visual/MediaLightboxModal.js';
import { ShotScriptCard } from './ShotScriptCard.js';
import { TiptapMentionEditor } from './TiptapMentionEditor.js';
import { toMentionText } from './EntityMentionText.js';
import { updateShotPrompt } from '../../../lib/api.js';

interface ShotSideDrawerPanelProps {
  node: CanvasShotNode;
  allNodes: CanvasShotNode[];
  projectId: string;
  clipId: string;
  projectData?: ProjectData | null;
  tasks: TaskRecord[];
  isBusy?: boolean;
  onClose: () => void;
  onRefreshProject?: () => void;
  onNodeUpdate: (updatedNode: CanvasShotNode) => void;
  onRenderVideo: (node: CanvasShotNode, customPrompt?: string) => Promise<void>;
  onExtractMotionPrompt: (shotId: string, targetClipId?: string) => Promise<void>;
  onSelectCandidate: (nodeId: string, taskId: string) => Promise<void>;
  onToggleContinuity: (node: CanvasShotNode) => Promise<void>;
  onEnlargeMedia?: (item: MediaLightboxItem & { gallery?: MediaLightboxItem[] }) => void;
}

export const ShotSideDrawerPanel: React.FC<ShotSideDrawerPanelProps> = ({
  node,
  allNodes,
  projectId,
  clipId,
  projectData,
  tasks,
  isBusy,
  onClose,
  onRefreshProject,
  onNodeUpdate,
  onRenderVideo,
  onExtractMotionPrompt,
  onSelectCandidate,
  onToggleContinuity,
  onEnlargeMedia,
}) => {
  const [activeTab, setActiveTab] = useState<'script' | 'prompt'>('script');
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [savePromptSuccess, setSavePromptSuccess] = useState(false);
  const [savePromptError, setSavePromptError] = useState<string | null>(null);

  const lookdevEntities = useMemo(() => {
    return (
      projectData?.artifacts?.lookdev_entities ||
      (projectData as any)?.lookdev_entities ||
      projectData?.entities ||
      null
    );
  }, [projectData]);

  // 同步当前选中节点的数据（自动把实体全名转换为 @提及 微胶囊）
  useEffect(() => {
    setCustomPrompt(
      toMentionText((node.videoPrompt || '').replace(/[@＠]{2,}/g, '@'), lookdevEntities)
    );
    setSelectedTaskId(node.activeTaskId || node.candidateTaskIds?.[0] || null);
    setSavePromptError(null);
  }, [node.id, node.videoPrompt, node.activeTaskId, node.candidateTaskIds, lookdevEntities]);

  const normalizedOriginalPrompt = (node.videoPrompt || '').replace(/[@＠]/g, '').trim();
  const normalizedCurrentPrompt = customPrompt.replace(/[@＠]/g, '').trim();
  const isPromptModified = normalizedCurrentPrompt !== normalizedOriginalPrompt;

  const handleSavePrompt = async () => {
    const sid = node.shotId || node.id;
    if (!projectId || !sid) return;
    setIsSavingPrompt(true);
    setSavePromptError(null);
    try {
      await updateShotPrompt(projectId, sid, 'video', normalizedCurrentPrompt);
      onNodeUpdate({
        ...node,
        videoPrompt: normalizedCurrentPrompt,
      });
      onRefreshProject?.();
      setSavePromptSuccess(true);
      setTimeout(() => setSavePromptSuccess(false), 2000);
    } catch (err: any) {
      setSavePromptError(err?.message || '保存视频提示词失败');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const candidates = node.candidateTaskIds || [];
  const selectedTask = useMemo(
    () => tasks.find((t) => t.taskId === selectedTaskId),
    [tasks, selectedTaskId]
  );

  const currentVideoUrl =
    selectedTask?.output?.mediaUrl ||
    selectedTask?.output?.videoUrl ||
    node.videoUrl;

  const isExtractingPrompt = tasks.some(
    (t) =>
      (t.status === 'running' || t.status === 'pending') &&
      t.toolName === 'film.shot_motion_prompt' &&
      t.input?.shotId === node.shotId
  );

  const isRenderingVideo = tasks.some(
    (t) =>
      (t.status === 'running' || t.status === 'pending') &&
      t.toolName === 'film.shot_video' &&
      t.input?.shotId === node.shotId
  );

  const continuityMode = (node.continuityMode || 'auto') as 'auto' | 'linked' | 'detached';
  const continuityLabel =
    continuityMode === 'linked'
      ? '🔗 继承尾帧'
      : continuityMode === 'detached'
      ? '✂️ 独立机位'
      : '🤖 智能连续';

  return (
    <aside
      className="absolute top-4 right-4 bottom-4 z-40 w-[450px] max-w-[calc(100vw-2rem)] bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-3xl shadow-xl flex flex-col overflow-hidden overscroll-contain animate-in slide-in-from-right-4 duration-200 select-none"
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 1. 顶部标题栏 */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
        <div className="flex items-center space-x-2.5 overflow-hidden">
          <span className="text-lg">🎬</span>
          <div className="truncate">
            <h3 className="text-sm font-bold text-slate-800 truncate">{node.title}</h3>
            <span className="text-[11px] text-slate-500 font-mono">
              {node.clipId || clipId} · {node.shotId || node.id}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 flex items-center justify-center text-sm font-bold"
          title="关闭侧边抽屉"
        >
          ✕
        </button>
      </div>

      {/* 2. 上方固定关键区：视频预览 + 关键状态与一键操作 */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100 space-y-3 bg-white shrink-0">
        {/* 16:9 播放器 */}
        <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-200 group">
          {currentVideoUrl ? (
            <video
              key={currentVideoUrl}
              src={currentVideoUrl}
              controls
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-xs text-slate-400 gap-1">
              <span className="text-2xl opacity-60">🎬</span>
              <span>暂无片段视频（H3 Ref2V 直出）</span>
            </div>
          )}

          {currentVideoUrl && onEnlargeMedia && (
            <button
              type="button"
              onClick={() => {
                const gallery: MediaLightboxItem[] = allNodes
                  .filter((n) => Boolean(n.videoUrl))
                  .map((n) => ({
                    title: `${n.title} · 视频`,
                    videoUrl: n.videoUrl || undefined,
                  }));
                onEnlargeMedia({
                  title: `${node.title} · 视频`,
                  videoUrl: currentVideoUrl,
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

        {/* 关键状态与连续性切换行 */}
        <div className="flex items-center justify-between text-xs gap-2">
          <span
            className={`inline-flex items-center gap-1.5 font-medium truncate ${
              node.videoUrl
                ? 'text-emerald-600'
                : node.videoPrompt
                ? 'text-indigo-600'
                : 'text-slate-400'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                node.videoUrl
                  ? 'bg-emerald-500 ring-2 ring-emerald-200'
                  : node.videoPrompt
                  ? 'bg-indigo-500 ring-2 ring-indigo-200'
                  : 'bg-slate-300'
              }`}
            />
            {isRenderingVideo
              ? '视频生成中...'
              : isExtractingPrompt
              ? '提示词推演中...'
              : node.videoUrl
              ? '视频已生成'
              : node.videoPrompt
              ? '提示词已就绪'
              : '片段待制作'}
          </span>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onToggleContinuity(node)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition ${
                continuityMode === 'linked'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : continuityMode === 'detached'
                  ? 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
              }`}
              title="点击切换前序片段接戏连续性模式"
            >
              {continuityLabel}
            </button>
            <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
              {node.durationSec || 4}s
            </span>
          </div>
        </div>

        {/* 若有多个候选版本，顶部提供紧凑版本切换条 */}
        {candidates.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {candidates.map((tid, idx) => {
              const isPlaying = selectedTaskId === tid;
              const isAdopted = node.activeTaskId === tid;
              return (
                <div key={tid} className="flex items-center shrink-0 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setSelectedTaskId(tid)}
                    className={`px-2 py-1 text-[11px] font-medium transition ${
                      isPlaying ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    版本 {idx + 1}
                    {isAdopted ? ' ✓' : ''}
                  </button>
                  {!isAdopted && isPlaying && (
                    <button
                      type="button"
                      onClick={() => onSelectCandidate(node.id, tid)}
                      className="px-1.5 py-1 text-[10px] text-indigo-600 hover:bg-indigo-50 border-l border-slate-200 font-semibold"
                    >
                      采纳
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 主操作按钮组：推演提示词 + 生成视频 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={isBusy || isExtractingPrompt}
            onClick={() => onExtractMotionPrompt(node.shotId || node.id, node.clipId || clipId)}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-800 text-xs font-semibold border border-slate-200 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <span>✨</span>
            <span>{isExtractingPrompt ? '推演中...' : node.videoPrompt ? '重推提示词' : '推演提示词'}</span>
          </button>

          <button
            type="button"
            disabled={isBusy || isRenderingVideo}
            onClick={() => onRenderVideo(node, customPrompt.trim() || undefined)}
            className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <span>🎬</span>
            <span>{isRenderingVideo ? '生成中...' : node.videoUrl ? '重新生成视频' : '生成视频'}</span>
          </button>
        </div>
      </div>

      {/* 3. 标签切换栏：片段剧本 / 视频提示词 */}
      <div className="px-5 pt-2.5 bg-slate-50/60 border-b border-slate-200/80 flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('script')}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
            activeTab === 'script'
              ? 'border-indigo-600 text-indigo-700 bg-white rounded-t-lg'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          📝 片段剧本
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('prompt')}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 ${
            activeTab === 'prompt'
              ? 'border-indigo-600 text-indigo-700 bg-white rounded-t-lg'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>🎥</span>
          <span>视频提示词</span>
          {node.videoPrompt && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
          )}
        </button>
      </div>

      {/* 4. 下方标签内容区 */}
      <div className="flex-1 overflow-y-auto p-5 text-slate-700 select-text">
        {activeTab === 'script' ? (
          <ShotScriptCard
            node={node}
            projectId={projectId}
            clipId={clipId}
            projectData={projectData}
            onRefreshProject={onRefreshProject}
            onNodeUpdate={onNodeUpdate}
          />
        ) : (
          <div className="space-y-3">
            {isPromptModified && (
              <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 animate-in fade-in duration-150">
                <span className="text-[11px] font-medium flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>视频提示词已修改</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setCustomPrompt(
                        toMentionText((node.videoPrompt || '').replace(/[@＠]{2,}/g, '@'), lookdevEntities)
                      )
                    }
                    className="px-2 py-0.5 rounded-md border border-amber-200 bg-white hover:bg-amber-100/60 text-[11px] font-medium text-amber-800 transition"
                  >
                    ↺ 还原
                  </button>
                  <button
                    type="button"
                    disabled={isSavingPrompt}
                    onClick={handleSavePrompt}
                    className="px-2.5 py-0.5 rounded-md bg-amber-600 hover:bg-amber-700 text-[11px] font-semibold text-white transition disabled:opacity-50"
                  >
                    {isSavingPrompt ? '保存中...' : '💾 保存'}
                  </button>
                </div>
              </div>
            )}

            {savePromptSuccess && (
              <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium flex items-center gap-1.5">
                <span>✓</span>
                <span>视频提示词已保存</span>
              </div>
            )}

            {savePromptError && (
              <div className="px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                ⚠ {savePromptError}
              </div>
            )}

            {(isExtractingPrompt || isRenderingVideo) && (
              <div className="px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                <span>{isExtractingPrompt ? '正在推演视频提示词，完成后将自动刷新...' : '正在渲染视频中，编辑区暂锁...'}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800">
                H3 Ref2V 视频动态提示词
              </label>
              <button
                type="button"
                onClick={() =>
                  setCustomPrompt(
                    toMentionText((node.videoPrompt || '').replace(/[@＠]{2,}/g, '@'), lookdevEntities)
                  )
                }
                className="text-[11px] text-slate-400 hover:text-slate-600"
              >
                还原已保存词
              </button>
            </div>

            <div className={isExtractingPrompt || isRenderingVideo ? 'pointer-events-none opacity-65 transition-opacity' : ''}>
              <TiptapMentionEditor
                value={customPrompt}
                onChange={(val) => setCustomPrompt(val)}
                entities={lookdevEntities}
                minRows={9}
                isModified={isPromptModified}
                placeholder="点击上方“推演提示词”自动生成，或输入 @ 快速插入角色/场景/道具并编辑「人物站位 + 时间戳多机位」视频提示词..."
              />
            </div>

            <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-[11px] text-indigo-900 leading-relaxed">
              支持输入 <span className="font-mono font-semibold">@</span> 引用角色/场景/道具；修改后可先点右上角保存，也可直接点击顶部“生成视频”。
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
