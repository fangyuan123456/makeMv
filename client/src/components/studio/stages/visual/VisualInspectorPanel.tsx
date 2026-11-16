/**
 * client/src/components/studio/stages/visual/VisualInspectorPanel.tsx
 * 视听制作右侧轻量预览检查器 (Visual Inspector SSOT)
 *
 * 职责分工：
 * 1. 【极轻量只读预览】不放复杂的修改输入框，消除越界感与拥挤感；
 * 2. 【定妆节点】只读预览已定妆角色与场景画廊，展示定妆进度；
 * 3. 【剧情节点】直接播放视听视频切片或大图、完整查看剧集剧本文本 (narrativeText)、速览分镜镜头；
 * 4. 【深潜引导】底部配备明显的「进入画布制作 ➔」按钮，也可以双击节点直接进入。
 */

import React from 'react';
import type { ProjectData } from '../../../../types/index.js';

interface StoryboardShotItem {
  id?: string;
  shotId?: string;
  shotSize?: string;
  shotType?: string;
  cameraMovement?: string;
  narration?: string;
  dialogue?: string;
  visualPromptZh?: string;
  promptZh?: string;
  imageUrl?: string;
  firstFrameImageUrl?: string;
  keyframeUrl?: string;
  [key: string]: any;
}

export interface VisualInspectorPanelProps {
  node: {
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
    durationSec?: number;
  };
  projectData: ProjectData | null;
  onClose: () => void;
  onEnterCanvas: (kind: 'lookdev' | 'clip', clipId?: string, clipTitle?: string) => void;
  onEnlargeMedia?: (media: { title: string; imageUrl?: string; videoUrl?: string }) => void;
}

export const VisualInspectorPanel: React.FC<VisualInspectorPanelProps> = ({
  node,
  projectData,
  onClose,
  onEnterCanvas,
  onEnlargeMedia,
}) => {
  // 1. 提取定妆视觉实体
  const entities = projectData?.entities || projectData?.artifacts?.lookdev_entities;
  const characters = entities?.characters || [];
  const locations = entities?.locations || [];

  // 2. 提取当前幕剧情文本
  const prd = projectData?.prd || projectData?.artifacts?.gdd?.prd;
  const currentClip = (prd?.clips || []).find((c: any) => c.id === node.clipId);
  const narrativeText =
    currentClip?.narrativeText ||
    (node.clipId ? projectData?.storySections?.[node.clipId]?.narrativeText : '') ||
    '暂无剧集文本描述';

  // 3. 提取分镜镜头列表
  const rawStoryboards = projectData?.storyboards || projectData?.artifacts?.storyboards || [];
  const filmSpec = projectData?.artifacts?.film_spec;

  const currentClipId = node.clipId;
  let shots: StoryboardShotItem[] = [];
  if (currentClipId && Array.isArray(rawStoryboards) && rawStoryboards.length > 0) {
    const matchedClip = rawStoryboards.find(
      (item: any) =>
        item.clipId === currentClipId ||
        item.id === currentClipId ||
        item.sourceNodeId === currentClipId ||
        item.clipId === `c${currentClipId.replace(/\D/g, '')}`
    );
    if (matchedClip && Array.isArray(matchedClip.shots)) {
      shots = matchedClip.shots;
    } else {
      shots = rawStoryboards.filter(
        (s: any) => s.clipId === currentClipId || s.sourceNodeId === currentClipId
      );
    }
  }

  if (shots.length === 0 && currentClipId && filmSpec?.clips) {
    const matched = filmSpec.clips.find(
      (c: any) =>
        c.clipId === currentClipId ||
        c.sourceNodeId === currentClipId ||
        c.clipId === `c${currentClipId.replace(/\D/g, '')}`
    );
    if (matched?.shots) shots = matched.shots;
  }

  return (
    <aside className="absolute top-4 right-4 bottom-4 w-[420px] max-w-[calc(100vw-2rem)] bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-3xl shadow-xl z-30 flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-200 select-none">
      {/* 顶部标题与关闭 */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
        <div className="flex items-center space-x-2.5 overflow-hidden">
          <span className="text-lg">
            {node.kind === 'lookdev' ? '🎨' : '🎬'}
          </span>
          <div className="truncate">
            <h3 className="text-sm font-bold text-slate-800 truncate">
              {node.title}
            </h3>
            <span className="text-[11px] text-slate-500 font-medium">
              {node.kind === 'lookdev'
                ? '全剧视觉定妆 · 快速预览'
                : '单幕视听切片 · 属性检视'}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          title="关闭检视面板"
        >
          ✕
        </button>
      </div>

      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-slate-700">
        {/* ────────────── A. 全剧视觉定妆预览 ────────────── */}
        {node.kind === 'lookdev' && (() => {
          const completedCharCount = characters.filter((c: any) => Boolean(c.imageUrl)).length;
          const totalCharCount = characters.length;
          const completedLocCount = locations.filter((l: any) => Boolean(l.imageUrl)).length;
          const totalLocCount = locations.length;

          return (
            <div className="space-y-4">
              <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-2xl flex items-center justify-between text-xs text-indigo-900">
                <span className="font-semibold">定妆完成度</span>
                <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                  <span className="font-bold bg-white px-2.5 py-0.5 rounded-full border border-indigo-200 text-indigo-700 shadow-2xs text-[11px]">
                    🎭 角色 {completedCharCount}/{totalCharCount}
                  </span>
                  <span className="font-bold bg-white px-2.5 py-0.5 rounded-full border border-indigo-200 text-indigo-700 shadow-2xs text-[11px]">
                    🏞️ 场景 {completedLocCount}/{totalLocCount}
                  </span>
                </div>
              </div>

              {/* 角色卡片只读预览 */}
              <div>
                <div className="text-xs font-bold text-slate-800 mb-2.5 flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <span>🎭</span>
                    <span>核心角色立绘</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    共 {characters.length} 个角色
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {characters.slice(0, 4).map((char: any, idx: number) => (
                    <div
                      key={char.characterId || char.id || `char_${idx}`}
                      onClick={() => {
                        if (char.imageUrl) {
                          onEnlargeMedia?.({
                            title: `角色定妆 · ${char.name}`,
                            imageUrl: char.imageUrl,
                          });
                        }
                      }}
                      className="group relative bg-slate-50 hover:bg-white border border-slate-200/80 hover:border-indigo-300 rounded-2xl p-2 overflow-hidden flex flex-col items-center transition-all cursor-pointer shadow-2xs hover:shadow-xs"
                      title={char.imageUrl ? '点击放大查看原图' : undefined}
                    >
                      <div className="w-full aspect-[3/4] rounded-xl overflow-hidden bg-slate-100 border border-slate-200/60 relative mb-2 flex items-center justify-center p-0.5">
                        {char.imageUrl ? (
                          <img
                            src={`${char.imageUrl}?t=${char.selectedVersionId || ''}`}
                            alt={char.name}
                            className="w-full h-full object-contain object-top group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs">
                            <span className="text-lg mb-1">⏳</span>
                            <span>待定妆</span>
                          </div>
                        )}
                        {char.versions && char.versions.length > 0 && (
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.2 rounded bg-black/60 text-[9px] font-mono text-white font-semibold">
                            v{char.versions.length}
                          </span>
                        )}
                      </div>
                      <div className="w-full text-center">
                        <div className="text-xs font-bold text-slate-800 truncate">
                          {char.name}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate mt-0.5">
                          {char.identity || '主要角色'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 场景只读预览 */}
              {locations.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-slate-800 mb-2.5 flex items-center justify-between">
                    <span className="flex items-center space-x-1.5">
                      <span>🏞️</span>
                      <span>关键场景画廊</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      共 {locations.length} 个场景
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {locations.slice(0, 2).map((loc: any, idx: number) => (
                      <div
                        key={loc.locationId || loc.id || `loc_${idx}`}
                        onClick={() => {
                          if (loc.imageUrl) {
                            onEnlargeMedia?.({
                              title: `场景氛围 · ${loc.name}`,
                              imageUrl: loc.imageUrl,
                            });
                          }
                        }}
                        className="bg-slate-50 hover:bg-white border border-slate-200/80 hover:border-indigo-300 rounded-2xl p-2 overflow-hidden flex flex-col items-center transition-all cursor-pointer shadow-2xs hover:shadow-xs"
                        title={loc.imageUrl ? '点击放大查看原图' : undefined}
                      >
                        <div className="w-full aspect-video rounded-xl overflow-hidden bg-slate-200 relative mb-1.5">
                          {loc.imageUrl ? (
                            <img
                              src={`${loc.imageUrl}?t=${loc.selectedVersionId || ''}`}
                              alt={loc.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                              待渲染
                            </div>
                          )}
                        </div>
                        <div className="text-xs font-medium text-slate-700 truncate w-full text-center">
                          {loc.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ────────────── B. 单幕剧情切片属性检视 ────────────── */}
        {node.kind === 'clip' && (
          <div className="space-y-4">
            {/* 1. 视听预览窗 (视频直接播放或关键帧大图) */}
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-inner group">
              {node.videoUrl ? (
                <video
                  src={node.videoUrl}
                  controls
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : node.keyframeUrl ? (
                <>
                  <img
                    src={node.keyframeUrl}
                    alt={node.title}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() =>
                      onEnlargeMedia?.({
                        title: node.title,
                        imageUrl: node.keyframeUrl,
                        videoUrl: node.videoUrl,
                      })
                    }
                    className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-xs text-[11px] font-medium text-white flex items-center space-x-1 transition-opacity opacity-0 group-hover:opacity-100"
                  >
                    <span>⛶ 放大查看</span>
                  </button>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                  <span className="text-2xl mb-1.5">🎬</span>
                  <span>本幕分镜镜头待规划生成</span>
                </div>
              )}
            </div>

            {/* 2. 剧集文本 (完整阅读剧情大纲描述，全部显示不截断不出现内嵌滑动条) */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                  <span>📖</span>
                  <span>剧集剧情文本</span>
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  本幕剧情蓝本
                </span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                {narrativeText}
              </p>
            </div>

            {/* 3. 分镜镜头清单概览 (全部自然展示，不设内部截断滚动条) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                  <span>🎞️</span>
                  <span>分镜镜头速览 ({shots.length})</span>
                </span>
              </div>

              {shots.length > 0 ? (
                <div className="space-y-2">
                  {shots.map((shot: StoryboardShotItem, idx) => (
                    <div
                      key={shot.id || shot.shotId || idx}
                      className="p-2.5 bg-slate-50/80 border border-slate-200/80 rounded-xl flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <span className="w-5 h-5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-[10px] flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <div className="truncate">
                          <div className="font-semibold text-slate-800 truncate">
                            {shot.shotSize || shot.shotType || '中景'} · {shot.cameraMovement || '固定镜头'}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {shot.narration || shot.dialogue || shot.visualPromptZh || shot.promptZh || '无旁白台词'}
                          </div>
                        </div>
                      </div>
                      {(shot.imageUrl || shot.keyframeUrl || shot.firstFrameImageUrl) && (
                        <img
                          src={shot.imageUrl || shot.keyframeUrl || shot.firstFrameImageUrl}
                          alt={`Shot ${idx + 1}`}
                          className="w-10 h-7 rounded object-cover shrink-0 ml-2 border border-slate-200"
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center text-xs text-slate-400">
                  暂未推演分镜镜头，双击节点即可进入推演
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部固定行动栏：双击下钻入口 */}
      <div className="p-4 bg-slate-50/90 border-t border-slate-100 flex items-center justify-between">
        <span className="text-[11px] text-slate-600 font-medium">
          💡 双击节点亦可直接进入
        </span>
        <button
          onClick={() => {
            if (node.kind === 'lookdev') {
              onEnterCanvas('lookdev');
            } else if (node.kind === 'clip' && node.clipId) {
              onEnterCanvas('clip', node.clipId, node.title);
            }
          }}
          disabled={!node.isUnlocked}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs ${
            node.isUnlocked
              ? 'bg-indigo-600 hover:bg-indigo-700 text-white hover:shadow-indigo-200'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          <span>进入画布制作</span>
          <span>➔</span>
        </button>
      </div>
    </aside>
  );
};
