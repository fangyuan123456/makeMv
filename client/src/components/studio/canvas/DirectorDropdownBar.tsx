/**
 * client/src/components/studio/canvas/DirectorDropdownBar.tsx
 * 开放视听元数据下拉条组件 (Director Dropdown Bar SSOT)
 *
 * 核心设计：
 * 1. 契约开放：支持任意由 AI 动态规划的视听指令 (VisualDirective)，彻底杜绝枚举穷举绑架；
 * 2. 经典好莱坞推荐库：下拉菜单提供高频工业级模板供创作者一键替换；
 * 3. 动态回显：无论 AI 规划了多么生僻的机位/姿态，均能原生精准回显。
 */

import React, { useState, useRef, useEffect } from 'react';
import type { VisualDirective } from '../../../types/index.js';
import {
  DIRECTOR_PRESETS,
  type DirectorPreset,
  type PresetCategory,
} from './presets/directorPresets.js';

export interface DirectorDirectives {
  camera?: VisualDirective;
  color?: VisualDirective;
  pose?: VisualDirective;
}

export function checkVisualDirectiveChanged(
  current?: VisualDirective,
  saved?: VisualDirective
): boolean {
  if (!current && !saved) return false;
  if (!current && saved) return true;
  if (current && !saved) return true;
  if (current?.presetId === 'custom' || saved?.presetId === 'custom') {
    return (
      (current?.presetId || '') !== (saved?.presetId || '') ||
      (current?.instruction || '').trim() !== (saved?.instruction || '').trim()
    );
  }
  return (current?.presetId || current?.label) !== (saved?.presetId || saved?.label);
}

interface DirectorDropdownBarProps {
  directives: DirectorDirectives;
  savedDirectives?: DirectorDirectives;
  onChange: (next: DirectorDirectives) => void;
  disabled?: boolean;
}

export const DirectorDropdownBar: React.FC<DirectorDropdownBarProps> = ({
  directives,
  savedDirectives,
  onChange,
  disabled = false,
}) => {
  const [openCategory, setOpenCategory] = useState<PresetCategory | null>(null);
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

  const categories: Array<{ id: PresetCategory; label: string; icon: string }> = [
    { id: 'color', label: '电影调色', icon: '🎨' },
  ];

  const handleSelectPreset = (category: PresetCategory, preset: DirectorPreset) => {
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

  const handleSelectCustom = (category: PresetCategory) => {
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

  const handleUpdateCustomInstruction = (category: PresetCategory, instruction: string) => {
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

  const getCustomPlaceholder = (catId: PresetCategory) => {
    switch (catId) {
      case 'camera':
        return '输入自定义机位要求（如：从半掩门缝向外窥视的主观视点 POV，前景带门框暗部边缘遮蔽与极端透视）...';
      case 'color':
        return '输入自定义调色风格（如：王家卫式微醺钨丝灯黄绿调，高对比度低饱和暗调，细腻电影胶片颗粒）...';
      case 'pose':
        return '输入自定义角色姿态（如：右手紧攥信件藏于胸前，身体微向前倾，视线斜视画左，眉头紧锁神情戒备）...';
    }
  };

  const handleClearCategory = (category: PresetCategory) => {
    onChange({
      ...directives,
      [category]: undefined,
    });
    setOpenCategory(null);
  };

  const handleResetCategory = (category: PresetCategory) => {
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
                  className="w-5 h-5 rounded-md hover:bg-amber-200/60 text-amber-700 hover:text-amber-900 flex items-center justify-center transition cursor-pointer shrink-0 disabled:opacity-50"
                  title={`还原到当前选择状态（${saved?.label || '默认未指定'}）`}
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

            {/* 轻量 Popover 下拉/上拉菜单 */}
            {isOpen && (
              <div className="absolute left-0 right-0 bottom-full mb-1.5 z-50 max-h-72 overflow-y-auto rounded-xl border border-slate-200/90 bg-white shadow-xl p-1.5 space-y-1 animate-in fade-in slide-in-from-bottom-2 duration-100">
                <div className="px-2 py-1 text-[10px] font-bold text-slate-400 flex items-center justify-between border-b border-slate-100 mb-1">
                  <span>视听配置 · {cat.label}</span>
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
                      自由输入专属于本镜头的{cat.label}提示词
                    </div>
                  </div>
                </button>

                <div className="pt-1 pb-0.5 px-2 text-[9px] font-bold text-slate-400 tracking-wider">
                  经典好莱坞预设
                </div>

                {DIRECTOR_PRESETS.filter((p) => p.category === cat.id).map((preset) => {
                  const isSelected = directives[cat.id]?.presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(cat.id, preset)}
                      className={`w-full p-1.5 rounded-lg text-left transition flex items-center gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50 border border-indigo-200 text-indigo-900 font-medium'
                          : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                      }`}
                    >
                      <div className="w-9 h-[22px] rounded overflow-hidden shrink-0 bg-slate-900 shadow-2xs">
                        {preset.renderThumbnail()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-bold truncate">
                            {preset.name}
                          </span>
                          <span className="text-[8px] px-1 py-0.2 rounded bg-slate-100 text-slate-500 shrink-0">
                            {preset.badge}
                          </span>
                        </div>
                        <div className="text-[9px] text-slate-400 truncate leading-tight">
                          {preset.enName}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
