/**
 * client/src/components/VideoStudio.tsx
 * 视频工坊主工作台 (Video Production Studio)
 *
 * 核心架构：
 * 1. 顶部：定妆卡片 (LookdevAssetDeck) —— 展示全剧角色、实物道具与场景外观提炼成果；
 * 2. 中间：工坊状态与操作栏 —— 展示视听资产就绪态与镜头规模；
 * 3. 主体：纯视听拓扑图 (FilmTopologyDiagram) —— 无互动点卡片，镜头切片与终局走向直连，主干严格居中；
 * 4. 侧边栏：选中镜头的分镜剧情与实物关联详情面板。
 */

import React, { useState, useEffect } from 'react';
import type {
  UniversalPrdSpec,
  StorySectionItem,
  LookdevEntitiesArtifact,
  FilmSliceArtifact,
  FilmAdapterArtifact,
  CinematicShotOrder,
  ProjectStudioTaskRegistry,
} from '../types/index.js';
import { LookdevAssetDeck } from './LookdevAssetDeck.js';
import { FilmTopologyDiagram } from './FilmTopologyDiagram.js';
import { executeStudioAction, fetchStudioTasks } from '../lib/api.js';

interface VideoStudioProps {
  projectId: string;
  taskId?: string;
  prd?: UniversalPrdSpec;
  storySections?: Record<string, StorySectionItem>;
  lookdevEntities?: LookdevEntitiesArtifact | null;
  filmSlices?: FilmSliceArtifact[];
  filmSpec?: FilmAdapterArtifact | null;
  studioTasks?: ProjectStudioTaskRegistry | null;
  onStartRender?: () => void;
  onRefresh?: () => void;
  className?: string;
}

export const VideoStudio: React.FC<VideoStudioProps> = ({
  projectId,
  taskId,
  prd,
  storySections,
  lookdevEntities,
  filmSlices,
  filmSpec,
  studioTasks: initialStudioTasks,
  onStartRender,
  onRefresh,
  className = '',
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeKeyframeShot, setActiveKeyframeShot] = useState<CinematicShotOrder | null>(null);
  const [localStudioTasks, setLocalStudioTasks] = useState<ProjectStudioTaskRegistry | null>(
    initialStudioTasks || null
  );

  // 轮询或加载多维任务树快照
  useEffect(() => {
    let cancelled = false;
    const loadTasks = async () => {
      try {
        const tasks = await fetchStudioTasks(projectId);
        if (!cancelled && tasks) {
          setLocalStudioTasks(tasks);
        }
      } catch {
        // 静默处理轮询或初次加载失败
      }
    };
    loadTasks();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 创作者微调与重做状态
  const [editKeyframePrompt, setEditKeyframePrompt] = useState('');
  const [editVideoPrompt, setEditVideoPrompt] = useState('');
  const [editReferenceImageUrl, setEditReferenceImageUrl] = useState('');
  const [actionLoading, setActionLoading] = useState<'keyframe' | 'video' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleOpenKeyframeShot = (shot: CinematicShotOrder) => {
    setActiveKeyframeShot(shot);
    setEditKeyframePrompt(shot.firstFramePrompt || '');
    setEditVideoPrompt(shot.videoPrompt || '');
    setEditReferenceImageUrl(shot.characterReferenceImageUrls?.[0] || '');
    setActionError(null);
  };

  // 重做定妆资产（角色立绘 / 道具特写 / 场景空镜）
  const handleRedoLookdevEntity = async ({
    actionType,
    targetId,
    customPrompt,
    referenceImageUrls,
  }: {
    actionType: 'character_portrait' | 'prop_lookdev' | 'scene_atmosphere';
    targetId: string;
    customPrompt?: string;
    referenceImageUrls?: string[];
  }) => {
    const res = await executeStudioAction(projectId, {
      taskId,
      actionType,
      targetId,
      customPrompt,
      referenceImageUrls,
      force: true,
    });
    if (res?.studioTasks) {
      setLocalStudioTasks(res.studioTasks);
    }
    onRefresh?.();
  };

  const handleRedoKeyframe = async () => {
    if (!activeKeyframeShot) return;
    setActionLoading('keyframe');
    setActionError(null);
    try {
      const res = await executeStudioAction(projectId, {
        taskId,
        actionType: 'shot_keyframe',
        targetId: activeKeyframeShot.shotId,
        clipId: activeKeyframeShot.clipId,
        customPrompt: editKeyframePrompt.trim() || undefined,
        referenceImageUrls: editReferenceImageUrl.trim() ? [editReferenceImageUrl.trim()] : undefined,
        force: true,
      });
      if (res?.studioTasks) {
        setLocalStudioTasks(res.studioTasks);
      }
      if (res?.result?.firstFrameImageUrl) {
        setActiveKeyframeShot((prev) =>
          prev
            ? {
                ...prev,
                firstFrameImageUrl: res.result.firstFrameImageUrl,
                firstFramePrompt: editKeyframePrompt.trim() || prev.firstFramePrompt,
              }
            : null
        );
      }
      onRefresh?.();
    } catch (err: any) {
      setActionError(err.message || '重做关键帧失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRedoVideo = async () => {
    if (!activeKeyframeShot) return;
    setActionLoading('video');
    setActionError(null);
    try {
      const res = await executeStudioAction(projectId, {
        taskId,
        actionType: 'shot_video',
        targetId: activeKeyframeShot.shotId,
        clipId: activeKeyframeShot.clipId,
        customPrompt: editVideoPrompt.trim() || undefined,
        referenceImageUrls: editReferenceImageUrl.trim() ? [editReferenceImageUrl.trim()] : undefined,
        force: true,
      });
      if (res?.studioTasks) {
        setLocalStudioTasks(res.studioTasks);
      }
      if (res?.result?.videoUrl) {
        setActiveKeyframeShot((prev) =>
          prev
            ? {
                ...prev,
                videoUrl: res.result.videoUrl,
                videoPrompt: editVideoPrompt.trim() || prev.videoPrompt,
              }
            : null
        );
      }
      onRefresh?.();
    } catch (err: any) {
      setActionError(err.message || '重做分镜视频失败');
    } finally {
      setActionLoading(null);
    }
  };

  const selectedClip = prd?.clips.find((c) => c.id === selectedNodeId);
  const selectedEnding = prd?.endings.find((e) => e.id === selectedNodeId);
  const selectedStory = selectedClip ? storySections?.[selectedClip.id] : undefined;

  // 匹配分镜订单中对应的切片与镜头清单
  const matchedFilmClip = filmSpec?.clips?.find(
    (c) => c.clipId === selectedNodeId || c.sourceNodeId === selectedNodeId
  );

  const clipCount = prd?.clips.length || 0;
  const endingCount = prd?.endings.length || 0;
  const charCount = lookdevEntities?.characters?.length || 0;
  const itemCount = lookdevEntities?.items?.length || 0;
  const locCount = lookdevEntities?.locations?.length || 0;
  const shotCount = filmSpec?.clips?.reduce((sum, c) => sum + (c.shots?.length || 0), 0) || 0;

  return (
    <div className={`video-studio-container ${className}`}>
      {/* 1. 最上面：定妆卡片 */}
      <div className="studio-top-section">
        <LookdevAssetDeck
          entities={lookdevEntities}
          studioTasks={localStudioTasks}
          onRedoEntity={handleRedoLookdevEntity}
        />
      </div>

      {/* 2. 工坊状态与概览工具栏 */}
      <div className="video-studio-toolbar">
        <div className="studio-meta-left">
          <div className="studio-badge-pill">
            <span className="dot pulse" />
            <span className="pill-title">视频工坊 · 视听资产与分镜看板</span>
          </div>
          <div className="studio-stats-summary">
            <span>📹 {clipCount} 个分镜镜头</span>
            <span className="sep">/</span>
            <span>🏁 {endingCount} 处终局</span>
            <span className="sep">/</span>
            <span>🎭 {charCount} 位登场角色</span>
            <span className="sep">/</span>
            <span>📦 {itemCount} 件关键道具</span>
            <span className="sep">/</span>
            <span>🏞️ {locCount} 处核心场景</span>
          </div>
        </div>

        <div className="studio-actions-right">
          <span className="studio-status-tag">待完成 · 视听资产提取已就绪</span>
          {onStartRender && (
            <button
              type="button"
              className="btn btn-primary btn-render-film"
              onClick={onStartRender}
            >
              🎬 启动全剧视频生成与装配
            </button>
          )}
        </div>
      </div>

      {/* 3. 主体工作区：去互动点的纯视听拓扑图 + 镜头详情抽屉 */}
      <div className="studio-main-workspace">
        <div className="studio-topo-wrapper">
          {prd ? (
            <FilmTopologyDiagram
              prd={prd}
              storySections={storySections}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => setSelectedNodeId((prev) => (prev === id ? null : id))}
              onClearSelection={() => setSelectedNodeId(null)}
            />
          ) : (
            <div className="studio-topo-empty">
              <span>📜</span>
              <h4>暂无可用策划案与分镜流向</h4>
              <p>请先在左侧完成阶段一策划案推演并确认进入视频工坊</p>
            </div>
          )}
        </div>

        {/* 4. 镜头 / 终局分镜详情抽屉 */}
        {(selectedClip || selectedEnding) && (
          <aside className="studio-detail-drawer">
            <div className="drawer-header">
              <div className="drawer-title-wrap">
                <span className="drawer-badge">
                  {selectedClip ? '镜头切片详情' : '终局分镜详情'}
                </span>
                <h4 className="drawer-title">
                  {selectedClip?.title || selectedEnding?.title || selectedNodeId}
                </h4>
              </div>
              <button
                type="button"
                className="btn-close-drawer"
                onClick={() => setSelectedNodeId(null)}
              >
                ✕
              </button>
            </div>

            <div className="drawer-content">
              {selectedClip && (
                <>
                  <div className="drawer-field">
                    <span className="field-label">镜头编号</span>
                    <span className="field-value mono">#{selectedClip.id}</span>
                  </div>

                  {selectedStory?.title && (
                    <div className="drawer-field">
                      <span className="field-label">幕次分段</span>
                      <span className="field-value">{selectedStory.title}</span>
                    </div>
                  )}

                  <div className="drawer-field">
                    <span className="field-label">镜头剧情与视听表现</span>
                    <p className="field-desc">
                      {selectedStory?.narrativeText || '暂无专属分段剧本说明'}
                    </p>
                  </div>

                  {selectedClip.video && (
                    <div className="drawer-field">
                      <span className="field-label">预设媒体标识</span>
                      <span className="field-value mono">{selectedClip.video}</span>
                    </div>
                  )}

                  {/* 核心功能：分镜镜头列表（点开分镜视频查看关键帧图） */}
                  {matchedFilmClip && matchedFilmClip.shots?.length > 0 && (
                    <div className="drawer-field">
                      <span className="field-label">
                        🎬 本幕分镜镜头 ({matchedFilmClip.shots.length})
                      </span>
                      <div className="studio-shots-list">
                        {matchedFilmClip.shots.map((shot, idx) => {
                          const shotTask =
                            matchedFilmClip &&
                            localStudioTasks?.acts?.[matchedFilmClip.clipId]?.shots?.[shot.shotId];

                          return (
                            <div
                              key={shot.shotId || idx}
                              className="studio-shot-card"
                              onClick={() => handleOpenKeyframeShot(shot)}
                            >
                              <div className="shot-card-thumb-wrap">
                                {shot.firstFrameImageUrl ? (
                                  <img
                                    src={shot.firstFrameImageUrl}
                                    alt={`镜头关键帧 ${shot.shotId}`}
                                    className="shot-keyframe-thumb"
                                  />
                                ) : (
                                  <div className="shot-thumb-placeholder">
                                    <span>🖼️</span>
                                    <span className="thumb-label">关键帧待生成</span>
                                  </div>
                                )}
                                <span className="shot-index-badge">#{shot.shotId}</span>
                                {shot.videoUrl && <span className="shot-video-tag">▶ 视频就绪</span>}
                              </div>
                              <div className="shot-card-info">
                                <div className="shot-meta-row">
                                  <span className="shot-type-pill">{shot.shotType}</span>
                                  <span className="shot-cam-pill">{shot.cameraMovement}</span>
                                  {shotTask?.keyframeTaskId && (
                                    <span className="shot-task-micro-pill" title={`关键帧任务: ${shotTask.keyframeTaskId}`}>
                                      ⚡帧: {shotTask.keyframeTaskId.slice(-6)}
                                    </span>
                                  )}
                                  {shotTask?.videoTaskId && (
                                    <span className="shot-task-micro-pill" title={`分镜视频任务: ${shotTask.videoTaskId}`}>
                                      🎬视: {shotTask.videoTaskId.slice(-6)}
                                    </span>
                                  )}
                                </div>
                                <p className="shot-desc">{shot.videoPrompt || shot.firstFramePrompt}</p>
                                <button
                                  type="button"
                                  className="btn-view-keyframe"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenKeyframeShot(shot);
                                  }}
                                >
                                  🔍 点开查看关键帧图与重做
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {selectedEnding && (
                <>
                  <div className="drawer-field">
                    <span className="field-label">结局类别</span>
                    <span className="field-value ending-badge-text">
                      [{selectedEnding.endingType}] {selectedEnding.isVictory ? '胜利终局' : '普通终局'}
                    </span>
                  </div>

                  <div className="drawer-field">
                    <span className="field-label">终局故事收敛</span>
                    <p className="field-desc">{selectedEnding.summary}</p>
                  </div>

                  {selectedEnding.rewindTargetClipId && (
                    <div className="drawer-field">
                      <span className="field-label">回溯锚点</span>
                      <span className="field-value mono">
                        ↩ 回溯至 #{selectedEnding.rewindTargetClipId}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* 5. 分镜视频关键帧大图检视弹窗 (点开分镜视频查看关键帧图与视频对照) */}
      {activeKeyframeShot && (() => {
        const activeClipId = activeKeyframeShot.clipId || selectedClip?.id;
        const currentShotTask = activeClipId
          ? localStudioTasks?.acts?.[activeClipId]?.shots?.[activeKeyframeShot.shotId]
          : undefined;

        return (
        <div className="keyframe-modal-overlay" onClick={() => setActiveKeyframeShot(null)}>
          <div className="keyframe-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="keyframe-modal-header">
              <div className="modal-title-wrap">
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="modal-badge">
                    分镜镜头视听检视 · #{activeKeyframeShot.shotId}
                  </span>
                  {currentShotTask?.keyframeTaskId && (
                    <span className="entity-task-pill" title={`关键帧任务槽位: ${currentShotTask.keyframeTaskId}`}>
                      ⚡ 帧Task: {currentShotTask.keyframeTaskId.slice(-8)}
                    </span>
                  )}
                  {currentShotTask?.videoTaskId && (
                    <span className="entity-task-pill" title={`视频任务槽位: ${currentShotTask.videoTaskId}`}>
                      🎬 视Task: {currentShotTask.videoTaskId.slice(-8)}
                    </span>
                  )}
                </div>
                <h3 className="modal-title">
                  {activeKeyframeShot.shotType} · {activeKeyframeShot.cameraMovement}
                </h3>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setActiveKeyframeShot(null)}
              >
                ✕
              </button>
            </div>

            <div className="keyframe-modal-body">
              {/* 左侧视听媒体区：关键帧大图与视频播放器 */}
              <div className="keyframe-media-stage">
                <div className="keyframe-viewer-box">
                  <div className="media-box-label">
                    <span>🖼️ 首帧关键帧原图 (Keyframe Image)</span>
                    {activeKeyframeShot.firstFrameImageUrl && (
                      <span className="badge-hires">HD</span>
                    )}
                  </div>
                  {activeKeyframeShot.firstFrameImageUrl ? (
                    <img
                      src={activeKeyframeShot.firstFrameImageUrl}
                      alt={`首帧关键帧 ${activeKeyframeShot.shotId}`}
                      className="keyframe-full-image"
                    />
                  ) : (
                    <div className="keyframe-pending-box">
                      <span>🎬</span>
                      <p>关键帧待生成</p>
                      <small>视频工坊启动后将基于剧本与定妆自动确立关键帧图</small>
                    </div>
                  )}
                </div>

                {/* 动态视频播放视窗（若已渲染生成） */}
                {activeKeyframeShot.videoUrl && (
                  <div className="keyframe-viewer-box video-box">
                    <div className="media-box-label">
                      <span>▶️ 生成的动态分镜视频 (Cinematography Video)</span>
                    </div>
                    <video
                      src={activeKeyframeShot.videoUrl}
                      controls
                      autoPlay
                      loop
                      className="shot-full-video"
                    />
                  </div>
                )}
              </div>

              {/* 右侧视听参数与提示词详情 (支持创作者微调与重做) */}
              <div className="keyframe-meta-panel">
                <div className="meta-block">
                  <div className="meta-label-row">
                    <span className="meta-label">首帧关键帧生图词 (可手动微调)</span>
                    <span className="meta-hint">修改后点击下方「重做关键帧」</span>
                  </div>
                  <textarea
                    className="prompt-edit-textarea"
                    rows={3}
                    value={editKeyframePrompt}
                    onChange={(e) => setEditKeyframePrompt(e.target.value)}
                    placeholder="可在此微调首帧生图提示词..."
                  />
                </div>

                <div className="meta-block">
                  <div className="meta-label-row">
                    <span className="meta-label">镜头动作表演与运镜 (可手动微调)</span>
                    <span className="meta-hint">修改后点击下方「重做视频」</span>
                  </div>
                  <textarea
                    className="prompt-edit-textarea"
                    rows={2}
                    value={editVideoPrompt}
                    onChange={(e) => setEditVideoPrompt(e.target.value)}
                    placeholder="可在此微调动作运镜描述词..."
                  />
                </div>

                <div className="meta-block">
                  <div className="meta-label-row">
                    <span className="meta-label">垫图参考图 (支持传外部参考图 URL)</span>
                  </div>
                  <input
                    type="text"
                    className="prompt-edit-input"
                    value={editReferenceImageUrl}
                    onChange={(e) => setEditReferenceImageUrl(e.target.value)}
                    placeholder="输入或粘贴参考图 URL（留空则默认使用角色立绘/场景空镜）"
                  />
                </div>

                {/* 统一工坊操作按钮栏 */}
                <div className="modal-actions-bar">
                  <button
                    type="button"
                    className="btn btn-action-redo btn-redo-keyframe"
                    disabled={Boolean(actionLoading)}
                    onClick={handleRedoKeyframe}
                  >
                    {actionLoading === 'keyframe' ? '⏳ 正在重绘关键帧...' : '🎨 重做关键帧 (Redo Keyframe)'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-action-redo btn-redo-video"
                    disabled={Boolean(actionLoading) || !activeKeyframeShot.firstFrameImageUrl}
                    onClick={handleRedoVideo}
                  >
                    {actionLoading === 'video' ? '⏳ 正在渲染视频...' : '🎬 重做分镜视频 (Redo Video)'}
                  </button>
                </div>

                {actionError && (
                  <div className="action-error-banner">
                    ⚠️ {actionError}
                  </div>
                )}

                {activeKeyframeShot.audioPrompt && (
                  <div className="meta-block">
                    <span className="meta-label">视听环境声与音乐氛围 (Audio Cue)</span>
                    <p className="meta-text">{activeKeyframeShot.audioPrompt}</p>
                  </div>
                )}

                {activeKeyframeShot.dialogue && (
                  <div className="meta-block">
                    <span className="meta-label">镜头台词 / 旁白 (Dialogue)</span>
                    <p className="meta-text dialogue-text">“{activeKeyframeShot.dialogue}”</p>
                  </div>
                )}

                <div className="meta-block-row">
                  <div className="meta-col">
                    <span className="meta-label">预定时长</span>
                    <span className="meta-val">{activeKeyframeShot.durationSec || 5} 秒</span>
                  </div>
                  <div className="meta-col">
                    <span className="meta-label">机位景别</span>
                    <span className="meta-val">{activeKeyframeShot.shotType}</span>
                  </div>
                  <div className="meta-col">
                    <span className="meta-label">运镜方式</span>
                    <span className="meta-val">{activeKeyframeShot.cameraMovement}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
};
