/**
 * client/src/components/studio/canvas/DirectorVideoDropdownBar.tsx
 * 视频专属运镜与动力学上拉选择条组件 (Director Video Dropdown Bar SSOT)
 *
 * 核心设计：
 * 1. 契约开放：支持任意由 AI 动态规划的视频运镜指令 (VisualDirective)，杜绝枚举穷举绑架；
 * 2. 好莱坞运镜推荐库：提供运镜方式、动态幅度、焦点跟踪三大维度的视觉缩略卡；
 * 3. 上拉防遮挡 (Dropup)：采用 bottom-full mb-1.5，避免与底部任务中心与悬浮球冲突；
 * 4. 视频专属：与图片模式彻底物理隔离。
 */

import React, { useState, useRef, useEffect } from 'react';
import type { VisualDirective } from '../../../types/index.js';
import {
  VIDEO_PRESETS,
  type VideoPreset,
  type VideoPresetCategory,
} from './presets/videoPresets.js';
import type { VideoDirectives } from './presets/promptDeconstructor.js';
import { checkVisualDirectiveChanged } from './DirectorDropdownBar.js';

interface DirectorVideoDropdownBarProps {
  directives: VideoDirectives;
  savedDirectives?: VideoDirectives;
  onChange: (next: VideoDirectives) => void;
  disabled?: boolean;
}

export const DirectorVideoDropdownBar: React.FC<DirectorVideoDropdownBarProps> = ({
  directives,
  savedDirectives,
  onChange,
  disabled = false,
}) => {
  const [openCategory, setOpenCategory] = useState<VideoPresetCategory | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部自动收起下拉浮层
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenCategory(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const categories: Array<{ id: VideoPresetCategory; label: string; icon: string }> = [
    { id: 'motion', label: '运镜轨迹', icon: '🎥' },
  ];

  const handleSelectPreset = (category: VideoPresetCategory, preset: VideoPreset) => {
    const currentVal = directives[category];
    const isSame = currentVal?.presetId === preset.id;
    const nextVal: VisualDirective | undefined = isSame
      ? undefined
      : {
          label: preset.name,
          instruction: preset.instruction,
          presetId: preset.id,
        };

    onChange({
      ...directives,
      [category]: nextVal,
    });
    setOpenCategory(null);
  };

  const handleSelectCustom = (category: VideoPresetCategory) => {
    // 优先读取当前正在使用的项，若无则读取 LLM 原始生成的设定
    const current = directives[category];
    const saved = savedDirectives?.[category];
    const base = current || saved;
    const defaultLabel = `自定义${categories.find((c) => c.id === category)?.label || ''}`;

    // 默认填入当前/AI生成的提示词指令，方便用户在上面微调
    const initialInstruction = (base?.instruction || saved?.instruction || '').trim();
    const nextVal: VisualDirective = {
      label: base?.label && base.presetId !== 'custom' ? `自定义 · ${base.label}` : defaultLabel,
      instruction: initialInstruction,
      presetId: 'custom',
    };
    onChange({
      ...directives,
      [category]: nextVal,
    });
    setOpenCategory(null);
  };

  const handleUpdateCustomInstruction = (category: VideoPresetCategory, instruction: string) => {
    const current = directives[category];
    const defaultLabel = `自定义${categories.find((c) => c.id === category)?.label || ''}`;
    onChange({
      ...directives,
      [category]: {
        label: current?.label || defaultLabel,
        instruction,
        presetId: 'custom',
      },
    });
  };

  const getCustomPlaceholder = (catId: VideoPresetCategory) => {
    switch (catId) {
      case 'motion':
        return '输入自定义运镜方式（如：摄影机沿斜对角线急速拉开 Whip Pan Pull-back，带来强烈的动态眩晕感）...';
      case 'dynamic':
        return '输入自定义动态幅度（如：激烈冲击震动 9/10，手持跟拍剧烈呼吸感与连续镜头抖动）...';
      case 'focus':
        return '输入自定义焦点跟踪（如：开篇焦点聚焦于手中的泛黄家书，随后焦点平滑转移至背景处暗门）...';
    }
  };

  const handleClearCategory = (category: VideoPresetCategory) => {
    onChange({
      ...directives,
      [category]: undefined,
    });
    setOpenCategory(null);
  };

  const handleResetCategory = (category: VideoPresetCategory) => {
    onChange({
      ...directives,
      [category]: savedDirectives?.[category],
    });
    setOpenCategory(null);
  };

  return (
    <div ref={containerRef} className="relative w-full space-y-1.5">
      {categories.map((cat) => {
        const active = directives[cat.id];
        const saved = savedDirectives?.[cat.id];
        const isChanged = checkVisualDirectiveChanged(active, saved);
        const isOpen = openCategory === cat.id;

        return (
          <div key={cat.id} className="relative w-full">
            <div
              className={`w-full px-2.5 py-1.5 rounded-xl text-xs transition-all flex items-center justify-between gap-2 border select-none ${
                isChanged
                  ? 'bg-amber-50/60 border-amber-300/80 text-slate-800 shadow-2xs'
                  : active
                  ? 'bg-indigo-50/70 border-indigo-200/90 text-slate-800 shadow-2xs'
                  : isOpen
                  ? 'bg-white border-indigo-300 ring-2 ring-indigo-500/10 text-slate-700 shadow-xs'
                  : 'bg-slate-50/80 hover:bg-white border-slate-200/70 text-slate-600 shadow-2xs'
              }`}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => setOpenCategory((curr) => (curr === cat.id ? null : cat.id))}
                className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer disabled:opacity-50"
                title={
                  active
                    ? `当前：${active.label}${isChanged ? `（已修改，原设定：${saved?.label || '未指定'}）` : '（当前镜头选择状态）'}`
                    : `点击选择${cat.label}`
                }
              >
                <span className="shrink-0 text-sm leading-none">{cat.icon}</span>
                <span className="text-[11px] font-semibold text-slate-500 shrink-0 w-14">
                  {cat.label}
                </span>
                <span
                  className={`truncate text-xs flex-1 ${
                    active ? 'text-indigo-950 font-semibold' : 'text-slate-400 italic font-normal'
                  }`}
                >
                  {active
                    ? active.presetId === 'custom'
                      ? active.instruction
                        ? `自定义：“${active.instruction}”`
                        : '自定义（点击下方输入要求）'
                      : active.label
                    : '默认未指定'}
                </span>
                {active?.presetId === 'custom' && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-900 font-bold shrink-0 border border-amber-300/60">
                    ✏️ 自定义
                  </span>
                )}
                {isChanged && active?.presetId !== 'custom' && (
                  <span className="text-[9px] px-1 py-0.2 rounded-full bg-amber-100 text-amber-800 font-normal shrink-0">
                    待生效
                  </span>
                )}
                {!isChanged && (
                  <span className={`text-[9px] text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    ▾
                  </span>
                )}
              </button>

              {/* 核心规则：仅当发生修改时才显示还原标 ↺；点击直接还原到当前镜头选择状态 */}
              {isChanged && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleResetCategory(cat.id);
                  }}
                  className="w-5 h-5 rounded-md hover:bg-amber-100/80 text-amber-600 hover:text-amber-800 flex items-center justify-center transition cursor-pointer shrink-0 disabled:opacity-50"
                  title={`还原${cat.label}为当前镜头选择状态（${saved?.label || '默认未指定'}）`}
                >
                  <svg className="w-3.5 h-3.5 transition-transform hover:-rotate-90 duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                </button>
              )}
            </div>

            {/* ✏️ 自定义指令内联展开输入框 */}
            {active?.presetId === 'custom' && (
              <div className="mt-1 px-2.5 py-2 rounded-xl bg-amber-50/50 border border-amber-200/80 shadow-2xs space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex items-center justify-between text-[10px] font-bold text-amber-900">
                  <span className="flex items-center gap-1">
                    <span>✏️</span>
                    <span>自定义{cat.label}要求 (Prompt Directive)</span>
                  </span>
                  <span className="text-[9px] text-amber-700/70 font-normal">
                    独立作用于本镜{cat.label}
                  </span>
                </div>
                <textarea
                  value={active.instruction || ''}
                  onChange={(e) => handleUpdateCustomInstruction(cat.id, e.target.value)}
                  disabled={disabled}
                  rows={2}
                  placeholder={getCustomPlaceholder(cat.id)}
                  className="w-full text-xs leading-relaxed bg-white border border-amber-200 focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 rounded-lg p-2 text-slate-800 outline-none resize-y placeholder:text-slate-400/70 transition shadow-2xs"
                />
              </div>
            )}

            {/* 上拉浮层卡片 (Dropup): 向上展开彻底杜绝遮挡 */}
            {isOpen && (
              <div className="absolute left-0 right-0 bottom-full mb-1.5 z-50 max-h-72 bg-white rounded-xl shadow-xl border border-slate-200/90 p-2 overflow-y-auto animate-in fade-in zoom-in-95 duration-100 space-y-1">
                <div className="flex items-center justify-between pb-1.5 mb-1 border-b border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400">
                    运镜配置 · {cat.label}
                  </span>
                  <div className="flex items-center gap-2">
                    {isChanged && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResetCategory(cat.id);
                        }}
                        className="text-amber-600 hover:text-amber-800 hover:underline cursor-pointer flex items-center gap-1 font-semibold text-[10px]"
                        title={`恢复为 AI 原设定（${saved?.label || '默认未指定'}）`}
                      >
                        <span>↺ 恢复AI设定</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* ✏️ 自定义专属选项卡 */}
                <button
                  type="button"
                  onClick={() => handleSelectCustom(cat.id)}
                  className={`w-full p-2 rounded-lg text-left transition flex items-center gap-2 cursor-pointer border ${
                    active?.presetId === 'custom'
                      ? 'bg-amber-50 border-amber-300 text-amber-900 font-medium'
                      : 'hover:bg-slate-50 text-slate-700 border-dashed border-slate-300/90'
                  }`}
                >
                  <div className="w-9 h-[24px] rounded flex items-center justify-center shrink-0 bg-amber-100 text-amber-800 text-xs shadow-2xs font-bold">
                    ✏️
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold text-amber-950">自定义{cat.label}...</span>
                      <span className="text-[8px] px-1.5 py-0.2 rounded bg-amber-200 text-amber-900 font-bold shrink-0">
                        自由调词
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-400 truncate leading-tight">
                      自由输入专属于本镜头的{cat.label}指令
                    </div>
                  </div>
                </button>

                <div className="pt-1 pb-0.5 px-2 text-[9px] font-bold text-slate-400 tracking-wider">
                  经典好莱坞预设
                </div>

                <div className="space-y-1">
                  {VIDEO_PRESETS.filter((p) => p.category === cat.id).map((preset) => {
                    const isSelected = active?.presetId === preset.id;
                    return (
                      <div
                        key={preset.id}
                        onClick={() => handleSelectPreset(cat.id, preset)}
                        className={`p-1.5 rounded-lg border transition cursor-pointer flex items-center gap-2 ${
                          isSelected
                            ? 'bg-indigo-50/90 border-indigo-400 ring-1 ring-indigo-400'
                            : 'bg-slate-50/50 hover:bg-slate-100/80 border-slate-200/70'
                        }`}
                      >
                        {/* 紧凑缩略图 */}
                        <div className="w-10 h-6 shrink-0 rounded overflow-hidden shadow-2xs border border-slate-700/40">
                          {preset.renderThumbnail()}
                        </div>

                        {/* 文本说明 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[11px] font-bold text-slate-800 truncate">
                              {preset.name}
                            </span>
                            <span className="text-[8px] px-1 py-0.2 rounded bg-indigo-100/70 text-indigo-700 font-medium shrink-0">
                              {preset.badge}
                            </span>
                          </div>
                          <p className="text-[9px] text-slate-500 truncate mt-0.5 leading-tight">
                            {preset.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
