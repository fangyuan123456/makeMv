/**
 * client/src/components/studio/canvas/SubCanvasSwitcher.tsx
 * 平行子制作画布快捷导航切换器 (Sub-Canvas Fast Switcher SSOT)
 *
 * 功能：
 * 1. 【秒级穿透互切】在定妆工坊与各幕分镜台本之间 1-click 原地切换，消灭强制退回流程拓扑的割裂体验；
 * 2. 【分镜连续步进】在分镜台本中提供「◀ 上一幕」与「下一幕 ▶」快捷按钮，支持连续流式创作；
 * 3. 【拓扑总览集成】随时一键回退到宏观流程拓扑大图。
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';

export interface SubCanvasOption {
  id: string; // 'lookdev' | clipId
  mode: 'lookdev' | 'clip';
  title: string;
  badge?: string;
  totalShots?: number;
  completedVideos?: number;
  isPlanned?: boolean;
  isUnlocked?: boolean;
}

export interface SubCanvasSwitcherProps {
  currentId: string; // 'lookdev' | clipId
  options: SubCanvasOption[];
  onSelect: (option: SubCanvasOption) => void;
  onBackToTopology: () => void;
  showStepButtons?: boolean;
  className?: string;
}

export const SubCanvasSwitcher: React.FC<SubCanvasSwitcherProps> = ({
  currentId,
  options,
  onSelect,
  onBackToTopology,
  showStepButtons = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部自动收起下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const currentOption = useMemo(
    () => options.find((opt) => opt.id === currentId) || options[0],
    [options, currentId]
  );

  const lookdevOption = useMemo(
    () => options.find((opt) => opt.mode === 'lookdev'),
    [options]
  );

  const clipOptions = useMemo(
    () => options.filter((opt) => opt.mode === 'clip'),
    [options]
  );

  // 当前分镜在所有分镜中的索引位置
  const currentClipIndex = useMemo(
    () => clipOptions.findIndex((opt) => opt.id === currentId),
    [clipOptions, currentId]
  );

  const prevClip = currentClipIndex > 0 ? clipOptions[currentClipIndex - 1] : null;
  const nextClip =
    currentClipIndex >= 0 && currentClipIndex < clipOptions.length - 1
      ? clipOptions[currentClipIndex + 1]
      : null;

  const canGoPrev = Boolean(prevClip && prevClip.isUnlocked !== false);
  const canGoNext = Boolean(nextClip && nextClip.isUnlocked !== false);

  return (
    <div
      ref={containerRef}
      className={`relative z-50 inline-flex items-center space-x-1.5 select-none ${className}`}
    >
      {/* 1. 退回宏观拓扑总览按钮 */}
      <button
        type="button"
        onClick={onBackToTopology}
        className="px-2.5 py-1.5 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center space-x-1.5 transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer"
        title="退回视听流程拓扑宏观图谱"
      >
        <span>←</span>
        <span>拓扑总览</span>
      </button>

      {/* 2. 平行子画布切换触发器 */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`px-3 py-1.5 rounded-xl border transition-all flex items-center space-x-2 text-xs font-bold shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer ${
          currentOption?.mode === 'lookdev'
            ? 'bg-indigo-50/90 border-indigo-200/90 text-indigo-900 hover:bg-indigo-100/90'
            : 'bg-white border-slate-200/90 text-slate-900 hover:bg-slate-50'
        }`}
      >
        <span className="text-sm">
          {currentOption?.mode === 'lookdev' ? '🎨' : '🎬'}
        </span>
        <span className="max-w-[200px] truncate tracking-tight">
          {currentOption?.title || '平行子画布'}
        </span>
        {currentOption?.badge && (
          <span className="text-[10px] font-medium px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 border border-slate-200/80">
            {currentOption.badge}
          </span>
        )}
        <span className={`text-[10px] text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {/* 3. 分镜步进前后切换按钮（仅在分镜画布或开启时显示） */}
      {showStepButtons && (
        <div className="flex items-center space-x-0.5 pl-0.5">
          <button
            type="button"
            disabled={!canGoPrev}
            onClick={() => canGoPrev && prevClip && onSelect(prevClip)}
            className="px-2 py-1.5 rounded-lg border border-slate-200/80 bg-white hover:bg-slate-50 text-[11px] font-medium text-slate-600 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
            title={prevClip ? (prevClip.isUnlocked === false ? '上一幕尚未解锁' : `切到上一幕：${prevClip.title}`) : '已是第一幕'}
          >
            ◀ 上一幕
          </button>
          <button
            type="button"
            disabled={!canGoNext}
            onClick={() => canGoNext && nextClip && onSelect(nextClip)}
            className="px-2 py-1.5 rounded-lg border border-slate-200/80 bg-white hover:bg-slate-50 text-[11px] font-medium text-slate-600 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
            title={nextClip ? (nextClip.isUnlocked === false ? '下一幕尚未解锁（需前驱视频全就绪）' : `切到下一幕：${nextClip.title}`) : '已是最后一幕'}
          >
            下一幕 ▶
          </button>
        </div>
      )}

      {/* 4. 下拉弹出菜单 (全剧平行子画布清单) */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 w-76 bg-white border border-slate-200/90 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.25)] ring-1 ring-slate-900/10 z-[100] py-2 divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100 font-sans">
          {/* 全局资产工坊 */}
          {lookdevOption && (
            <div className="p-1.5">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2.5 py-1">
                全剧通用资产
              </div>
              <button
                type="button"
                onClick={() => {
                  onSelect(lookdevOption);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition cursor-pointer ${
                  currentId === 'lookdev'
                    ? 'bg-indigo-50 border border-indigo-200/80 text-indigo-900 font-bold'
                    : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span className="text-base">🎨</span>
                  <div>
                    <div className="text-xs">{lookdevOption.title}</div>
                    <div className="text-[10px] text-slate-400">
                      角色三视图、场景氛围、实物道具
                    </div>
                  </div>
                </div>
                {lookdevOption.badge && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/60">
                    {lookdevOption.badge}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* 各幕视听分镜台本 */}
          <div className="p-1.5 max-h-72 overflow-y-auto">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2.5 py-1 flex items-center justify-between">
              <span>各幕分镜台本</span>
              <span className="font-mono text-slate-500 font-normal">
                {clipOptions.length} 幕
              </span>
            </div>
            {clipOptions.length === 0 ? (
              <div className="text-[11px] text-slate-400 italic px-2.5 py-2">
                暂未切分剧本分幕切片
              </div>
            ) : (
              clipOptions.map((clip, idx) => {
                const isSelected = clip.id === currentId;
                const isClipUnlocked = clip.isUnlocked !== false;
                return (
                  <button
                    key={clip.id}
                    type="button"
                    disabled={!isClipUnlocked}
                    onClick={() => {
                      if (!isClipUnlocked) return;
                      onSelect(clip);
                      setIsOpen(false);
                    }}
                    title={!isClipUnlocked ? '需前驱镜头视频全部就绪后方可解锁' : undefined}
                    className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between transition mb-0.5 ${
                      !isClipUnlocked
                        ? 'opacity-40 cursor-not-allowed bg-slate-50/40 text-slate-400'
                        : isSelected
                        ? 'bg-indigo-50 border border-indigo-200/80 text-indigo-900 font-bold cursor-pointer'
                        : 'hover:bg-slate-50 text-slate-700 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0 pr-2">
                      <span className="text-xs flex-shrink-0">
                        {!isClipUnlocked ? '🔒' : isSelected ? '🎬' : '🎞️'}
                      </span>
                      <div className="min-w-0 truncate">
                        <span className="text-xs truncate block">
                          {clip.title}
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex items-center space-x-1">
                      {!isClipUnlocked ? (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-400">
                          待解锁
                        </span>
                      ) : clip.badge ? (
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                            clip.totalShots && clip.completedVideos === clip.totalShots
                              ? 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-200/60'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {clip.badge}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* 底部回到拓扑 */}
          <div className="p-1.5 bg-slate-50/50 rounded-b-2xl">
            <button
              type="button"
              onClick={() => {
                onBackToTopology();
                setIsOpen(false);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-slate-600 hover:bg-slate-100 flex items-center space-x-2 transition cursor-pointer"
            >
              <span>🗺️</span>
              <span>返回视听制作流向拓扑大图</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
