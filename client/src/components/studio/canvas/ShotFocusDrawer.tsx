/**
 * client/src/components/studio/canvas/ShotFocusDrawer.tsx
 * 递进式镜头深度演播舱 (Drill-Down Focus Studio SSOT)
 *
 * 核心特性：
 * 1. 递进三工序贯通：
 *    - 工序 1：首帧定妆底图 (Keyframe Lookdev)
 *    - 工序 2：运镜参数与动态 Prompt (Cinematics & Motion Prompt)
 *    - 工序 3：多候选方案大屏对比播映 (Candidate Studio & A/B Selection)
 * 2. 独立单镜头重制：直接从当前抽屉发起渲染，自动扩充候选库；
 * 3. 兼容全剧定妆母体节点 (Lookdev Root) 的全局定妆总览。
 */

import React, { useState, useEffect, useRef } from 'react';
import type { CanvasShotNode, TaskRecord, ProjectData } from '../../../types/index.js';
import { fetchTasks } from '../../../lib/api.js';

interface ShotFocusDrawerProps {
  node: CanvasShotNode | null;
  projectId: string;
  projectData?: ProjectData | null;
  onClose: () => void;
  onSelectCandidate: (nodeId: string, taskId: string) => Promise<void>;
  onRenderVideo: (node: CanvasShotNode, customPrompt?: string) => Promise<void>;
  onRenderKeyframe?: (shotId: string) => Promise<void>;
  isBusy?: boolean;
}

export const ShotFocusDrawer: React.FC<ShotFocusDrawerProps> = ({
  node,
  projectId,
  projectData,
  onClose,
  onSelectCandidate,
  onRenderVideo,
  onRenderKeyframe,
  isBusy,
}) => {
  const [activeStep, setActiveStep] = useState<'keyframe' | 'motion' | 'candidates'>('candidates');
  const [customPrompt, setCustomPrompt] = useState('');
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoPlayerRef = useRef<HTMLVideoElement>(null);

  // 初始化与节点变化同步
  useEffect(() => {
    if (node) {
      setCustomPrompt(node.prompt || '');
      setSelectedTaskId(node.activeTaskId || (node.candidateTaskIds && node.candidateTaskIds[0]) || null);
      if (node.type === 'lookdev_root') {
        setActiveStep('keyframe');
      } else if (!node.videoUrl && node.keyframeUrl) {
        setActiveStep('motion');
      } else if (!node.keyframeUrl) {
        setActiveStep('keyframe');
      } else {
        setActiveStep('candidates');
      }
    }
  }, [node]);

  // 加载项目任务历史用于匹配候选版本
  useEffect(() => {
    if (!projectId || !node) return;
    fetchTasks(projectId)
      .then((res) => setTasks(res))
      .catch((err) => console.warn('[ShotFocusDrawer] 加载任务历史失败:', err));
  }, [projectId, node]);

  if (!node) return null;

  const isLookdevRoot = node.type === 'lookdev_root';
  const candidates = node.candidateTaskIds || [];

  // 获取匹配的候选任务详情列表
  const candidateTasks = candidates
    .map((tid) => tasks.find((t) => t.taskId === tid))
    .filter(Boolean) as TaskRecord[];

  // 确定当前大屏播放的视频 URL
  const selectedTask = tasks.find((t) => t.taskId === selectedTaskId);
  const currentVideoUrl =
    selectedTask?.output?.mediaUrl ||
    selectedTask?.output?.videoUrl ||
    node.videoUrl;

  const handleAdoptCandidate = async (taskId: string) => {
    setSelectedTaskId(taskId);
    await onSelectCandidate(node.id, taskId);
  };

  const handleTriggerReRender = async () => {
    if (!node) return;
    await onRenderVideo(node, customPrompt);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex pointer-events-auto">
      {/* 遮罩背景 */}
      <div
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-2xs transition-opacity"
        onClick={onClose}
      />

      {/* 演播舱滑盖抽屉主容器 */}
      <div className="relative w-[540px] max-w-[90vw] h-full bg-white shadow-2xl flex flex-col border-l border-slate-200/90 z-10 animate-in slide-in-from-right duration-200">
        {/* 抽屉顶栏 */}
        <div className="px-6 py-4 border-b border-slate-200/90 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center space-x-2.5 truncate">
            <span className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-sm shadow-2xs">
              {isLookdevRoot ? '🧬' : '🎥'}
            </span>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold px-1.5 py-0.2 rounded bg-indigo-100/70 text-indigo-700">
                  {isLookdevRoot ? 'ROOT' : node.clipId || node.shotId}
                </span>
                <h3 className="text-sm font-bold text-slate-900 truncate" title={node.title}>
                  {node.title}
                </h3>
              </div>
              <p className="text-[11px] text-slate-400">
                {isLookdevRoot ? '全剧视觉母体定妆总览' : '递进式镜头演播工作舱 · 独立制作与方案决策'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition flex items-center justify-center text-sm font-bold"
            title="关闭抽屉"
          >
            ✕
          </button>
        </div>

        {/* 模式 A：如果是全剧定妆母体 (Lookdev Root) */}
        {isLookdevRoot ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <h4 className="text-xs font-bold text-slate-900 mb-3 flex items-center gap-1.5">
                <span>👤</span>
                <span>核心角色定妆立绘库 ({node.characters?.length || 0})</span>
              </h4>
              <div className="grid grid-cols-2 gap-3">
                {(node.characters || []).map((c, idx) => (
                  <div
                    key={c.characterId || idx}
                    className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col items-center space-y-2 shadow-2xs"
                  >
                    <div className="w-full h-36 rounded-xl overflow-hidden bg-white border border-slate-200">
                      {c.imageUrl ? (
                        <img
                          src={c.imageUrl}
                          alt={c.name}
                          className="w-full h-full object-cover object-top"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                          暂无立绘
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-bold text-slate-800">{c.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-900 mb-3 flex items-center gap-1.5">
                <span>🏞️</span>
                <span>主场景氛围基准库 ({node.locations?.length || 0})</span>
              </h4>
              <div className="grid grid-cols-2 gap-3">
                {(node.locations || []).map((loc, idx) => (
                  <div
                    key={loc.locationId || idx}
                    className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col space-y-2 shadow-2xs"
                  >
                    <div className="w-full h-28 rounded-xl overflow-hidden bg-white border border-slate-200">
                      {loc.imageUrl ? (
                        <img
                          src={loc.imageUrl}
                          alt={loc.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                          暂无场景图
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-bold text-slate-800 truncate">{loc.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* 模式 B：分镜镜头递进式演播工作舱 */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 递进工序导航 Tab 胶囊 */}
            <div className="px-6 py-2.5 bg-slate-100/60 border-b border-slate-200 flex items-center justify-between text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveStep('keyframe')}
                className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
                  activeStep === 'keyframe'
                    ? 'bg-white text-indigo-700 shadow-2xs border border-indigo-200/80'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>①</span>
                <span>首帧底图</span>
              </button>

              <span className="text-slate-300">➔</span>

              <button
                type="button"
                onClick={() => setActiveStep('motion')}
                className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
                  activeStep === 'motion'
                    ? 'bg-white text-indigo-700 shadow-2xs border border-indigo-200/80'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>②</span>
                <span>运镜与Prompt</span>
              </button>

              <span className="text-slate-300">➔</span>

              <button
                type="button"
                onClick={() => setActiveStep('candidates')}
                className={`px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 ${
                  activeStep === 'candidates'
                    ? 'bg-white text-indigo-700 shadow-2xs border border-indigo-200/80'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>③</span>
                <span>方案播映室 ({candidates.length || (node.videoUrl ? 1 : 0)})</span>
              </button>
            </div>

            {/* 抽屉内容展示区 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 工序 1：首帧底图工序 */}
              {activeStep === 'keyframe' && (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span>🖼️</span>
                        <span>首帧关键帧底图</span>
                      </span>
                      {onRenderKeyframe && (
                        <button
                          type="button"
                          onClick={() => onRenderKeyframe(node.shotId || node.id)}
                          disabled={isBusy}
                          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          重新生成底图
                        </button>
                      )}
                    </h4>
                    <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-200 shadow-xs flex items-center justify-center">
                      {node.keyframeUrl ? (
                        <img
                          src={node.keyframeUrl}
                          alt={node.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center p-6 space-y-2">
                          <span className="text-3xl">🖼️</span>
                          <p className="text-xs text-slate-400">尚未生成首帧底图</p>
                          {onRenderKeyframe && (
                            <button
                              type="button"
                              onClick={() => onRenderKeyframe(node.shotId || node.id)}
                              disabled={isBusy}
                              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold shadow-xs"
                            >
                              立即绘制首帧
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                    <span className="text-xs font-bold text-slate-700">首帧视觉描述：</span>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {node.prompt || '暂无详细描述'}
                    </p>
                  </div>
                </div>
              )}

              {/* 工序 2：运镜与动作 Prompt */}
              {activeStep === 'motion' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                      <span className="text-[10px] text-slate-400 font-medium">预定时长</span>
                      <p className="text-sm font-mono font-bold text-slate-800">
                        {node.durationSec || 4.0} 秒
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                      <span className="text-[10px] text-slate-400 font-medium">生成模式</span>
                      <p className="text-sm font-bold text-indigo-700">首帧图生视频</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span>📝</span>
                        <span>视听动态提示词 (Video Motion Prompt)</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setCustomPrompt(node.prompt || '')}
                        className="text-[10px] text-slate-400 hover:text-slate-600"
                      >
                        重置默认
                      </button>
                    </div>
                    <textarea
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      rows={5}
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 resize-none leading-relaxed text-slate-800 font-sans"
                      placeholder="编辑运镜轨迹、主体动作与环境氛围变化..."
                    />
                  </div>

                  <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs text-indigo-900 leading-relaxed flex items-start gap-2">
                    <span>💡</span>
                    <span>
                      在此调整运镜描述后，切换到【方案播映室】点击“渲染新版本”，即可生成独立候选视频。
                    </span>
                  </div>
                </div>
              )}

              {/* 工序 3：多方案大屏演播室 */}
              {activeStep === 'candidates' && (
                <div className="space-y-5">
                  {/* 大屏高清播放器 */}
                  <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 shadow-md group flex items-center justify-center">
                    {currentVideoUrl ? (
                      <video
                        ref={videoPlayerRef}
                        src={currentVideoUrl}
                        poster={node.keyframeUrl}
                        controls
                        playsInline
                        className="w-full h-full object-contain"
                      />
                    ) : node.keyframeUrl ? (
                      <div className="relative w-full h-full">
                        <img
                          src={node.keyframeUrl}
                          alt="首帧占位"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <button
                            type="button"
                            onClick={handleTriggerReRender}
                            disabled={isBusy}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-indigo-700 transition"
                          >
                            🎬 渲染首版视频
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center p-6 space-y-2 text-slate-400">
                        <span className="text-3xl">🎬</span>
                        <p className="text-xs">尚无视频成片</p>
                      </div>
                    )}
                  </div>

                  {/* 多候选方案列表 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <span>🗂️</span>
                        <span>方案候选库 ({candidates.length || (node.videoUrl ? 1 : 0)})</span>
                      </span>
                      <span className="text-[10px] text-slate-400">点击切换播映与采纳</span>
                    </div>

                    {candidates.length > 0 ? (
                      <div className="space-y-2">
                        {candidates.map((tid, idx) => {
                          const matchedTask = tasks.find((t) => t.taskId === tid);
                          const isCurrentActive = node.activeTaskId === tid;
                          const isCurrentPlaying = selectedTaskId === tid;

                          return (
                            <div
                              key={tid}
                              onClick={() => setSelectedTaskId(tid)}
                              className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between ${
                                isCurrentPlaying
                                  ? 'bg-indigo-50/70 border-indigo-400 ring-1 ring-indigo-400/20 shadow-xs'
                                  : 'bg-white border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-center space-x-3 truncate">
                                <span
                                  className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${
                                    isCurrentActive
                                      ? 'bg-indigo-600 text-white'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {idx + 1}
                                </span>
                                <div className="truncate">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-xs font-bold text-slate-800">
                                      方案 {idx + 1}
                                    </span>
                                    {isCurrentActive && (
                                      <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-700">
                                        主线采纳中
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] font-mono text-slate-400 truncate">
                                    Task ID: {tid}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center space-x-2 shrink-0">
                                {!isCurrentActive && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAdoptCandidate(tid);
                                    }}
                                    className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-indigo-600 text-xs font-semibold rounded-lg border border-indigo-200 shadow-2xs transition active:scale-95"
                                  >
                                    采纳为主线
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
                        当前镜头仅有 1 份默认视频，可点击下方按钮渲染新方案。
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 抽屉底栏操作栏 */}
            <div className="p-4 bg-white border-t border-slate-200/90 flex items-center justify-between gap-3 shadow-2xs">
              <div className="text-[11px] text-slate-400">
                {isBusy ? '正在调度 GPU 渲染中...' : '支持针对本镜头无损渲染全新方案'}
              </div>

              <button
                type="button"
                onClick={handleTriggerReRender}
                disabled={isBusy}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition active:scale-98 flex items-center gap-1.5 disabled:opacity-50"
              >
                <span>🎬</span>
                <span>{isBusy ? '渲染中...' : '渲染新版本方案'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};