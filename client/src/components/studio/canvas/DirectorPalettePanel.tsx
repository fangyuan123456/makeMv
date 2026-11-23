/**
 * client/src/components/studio/canvas/DirectorPalettePanel.tsx
 * 导演视听调节工具箱面板 (Director Visual Palette Panel SSOT)
 *
 * 特性：
 * 1. 纯图解驱动：涵盖机位、调色、姿势，每个选项均配有独立精致的矢量视觉预览图；
 * 2. 交互点选：点击卡片即时选中/取消，支持跨维度组合（如机位+调色+姿势）；
 * 3. 自动合成专业影视微调指令并同步回填。
 */

import React, { useState } from 'react';
import {
  DIRECTOR_PRESETS,
  type DirectorPreset,
  type PresetCategory,
} from './presets/directorPresets.js';

interface DirectorPalettePanelProps {
  onApplyInstruction: (instruction: string) => void;
  onClose?: () => void;
  disabled?: boolean;
}

export const DirectorPalettePanel: React.FC<DirectorPalettePanelProps> = ({
  onApplyInstruction,
  onClose,
  disabled = false,
}) => {
  const [activeCategory, setActiveCategory] = useState<PresetCategory>('camera');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const categories: Array<{ id: PresetCategory; label: string; icon: string }> = [
    { id: 'camera', label: '机位与视角', icon: '🎥' },
    { id: 'color', label: '电影调色', icon: '🎨' },
    { id: 'pose', label: '角色姿态', icon: '🧍' },
  ];

  const currentPresets = DIRECTOR_PRESETS.filter((p) => p.category === activeCategory);

  const toggleSelect = (preset: DirectorPreset) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(preset.id)) {
        next.delete(preset.id);
      } else {
        // 同一类目下默认互斥单选，不同类目间可自由组合
        for (const existingId of next) {
          const matched = DIRECTOR_PRESETS.find((p) => p.id === existingId);
          if (matched && matched.category === preset.category) {
            next.delete(existingId);
          }
        }
        next.add(preset.id);
      }
      return next;
    });
  };

  // 根据当前已选中的预设自动合成连贯流畅的影视微调指令
  const getSynthesizedInstruction = (): string => {
    const selectedPresets = DIRECTOR_PRESETS.filter((p) => selectedIds.has(p.id));
    if (selectedPresets.length === 0) return '';

    const camPreset = selectedPresets.find((p) => p.category === 'camera');
    const colorPreset = selectedPresets.find((p) => p.category === 'color');
    const posePreset = selectedPresets.find((p) => p.category === 'pose');

    const parts: string[] = ['保持原画面核心角色身份与空间环境不变'];
    if (camPreset) {
      parts.push(`机位调整为${camPreset.name}（${camPreset.enName}）`);
    }
    if (posePreset) {
      parts.push(`角色姿态与肢体调整为${posePreset.name}（${posePreset.description}）`);
    }
    if (colorPreset) {
      parts.push(`画面采用${colorPreset.name}电影工艺调色（${colorPreset.enName}，${colorPreset.description}）`);
    }

    return parts.join('，') + '。';
  };

  const synthesizedText = getSynthesizedInstruction();

  const handleApply = () => {
    if (!synthesizedText.trim()) return;
    onApplyInstruction(synthesizedText);
    setSelectedIds(new Set());
  };

  return (
    <div className="rounded-2xl border border-indigo-200/90 bg-white/95 shadow-md p-3 select-none">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">🎬</span>
          <span className="text-xs font-bold text-slate-800">导演视听工具箱</span>
          <span className="text-[10px] text-slate-500 font-normal">（点击图解卡片直观调整）</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            ✕
          </button>
        )}
      </div>

      {/* 分类 Tabs */}
      <div className="mt-2.5 flex items-center gap-1 p-0.5 rounded-xl bg-slate-100/90">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1 ${
              activeCategory === cat.id
                ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* 卡片展示网格 */}
      <div className="mt-2.5 grid grid-cols-2 gap-2 max-h-56 overflow-y-auto p-0.5">
        {currentPresets.map((preset) => {
          const isSelected = selectedIds.has(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => toggleSelect(preset)}
              className={`group relative text-left rounded-xl p-1.5 border transition cursor-pointer disabled:opacity-60 flex flex-col gap-1.5 ${
                isSelected
                  ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20 shadow-xs'
                  : 'border-slate-200 hover:border-indigo-300 bg-white hover:bg-slate-50/60'
              }`}
            >
              {/* 独立精美 SVG 视觉图解 */}
              <div className="relative w-full aspect-[8/5] rounded-lg overflow-hidden bg-slate-900 shadow-2xs">
                {preset.renderThumbnail()}
                <span className="absolute top-1 right-1 px-1 py-0.5 rounded bg-black/70 backdrop-blur-xs text-[9px] font-medium text-slate-200">
                  {preset.badge}
                </span>
                {isSelected && (
                  <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-indigo-600 text-[9px] font-bold text-white shadow-2xs">
                    ✓ 已选
                  </span>
                )}
              </div>

              {/* 标题与描述 */}
              <div className="min-w-0 px-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-bold text-slate-900 truncate">
                    {preset.name}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono shrink-0">
                    {preset.enName}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 line-clamp-1 leading-tight mt-0.5">
                  {preset.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 底部已选组合与一键应用栏 */}
      {selectedIds.size > 0 && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-col gap-2">
          <div className="text-[10px] text-indigo-700 bg-indigo-50/80 p-2 rounded-lg border border-indigo-100 leading-snug">
            <span className="font-bold">✨ 已选组合指令：</span>
            <span>{synthesizedText}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              清空
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={handleApply}
              className="flex-1 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold shadow-xs cursor-pointer disabled:opacity-50"
            >
              填入微调指令
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
