/**
 * client/src/components/studio/stages/visual/components/ItemCard.tsx
 * 核心道具视觉展台卡片 (高内聚深模块 SSOT)
 */

import React from 'react';
import type { TaskRecord } from '../../../../../types/index.js';
import { getEntityTaskStatus } from '../../../../../lib/taskUtils.js';

export interface ItemCardProps {
  item: any;
  isSelected: boolean;
  tasks?: TaskRecord[];
  isBusy: boolean;
  itemRefImg?: string;
  isGenerating: boolean;
  isSpecExtracting: boolean;
  isUpscaling: boolean;
  isModified?: boolean;
  currentPrompt: string;
  activeRefineEntityId: string | null;
  refineInput: string;
  isSubmittingRefine: boolean;
  uploadingEntityId: string | null;
  getActiveUpscale: (entity: any) => { multiplier: number } | undefined;
  getSelectedVersionNumber: (entity: any) => number;
  getStableImageSrc: (url: string, entity: any) => string;
  getImageGallery: (entity: any, titlePrefix: string) => any[];
  onSelect: () => void;
  onOpenVersions: () => void;
  onEnlargeMedia?: (media: any) => void;
  onTriggerUpload: () => void;
  onToggleRefine: () => void;
  onRefineInputChange: (val: string) => void;
  onSubmitRefine: () => void;
  onUpscale: () => void;
  onExtractSpec: () => void;
  onPromptDraftChange: (val: string) => void;
  onRevertPrompt: () => void;
  onGenerate: () => void;
  onRetryTask?: (taskId: string) => void;
}

export const ItemCard: React.FC<ItemCardProps> = ({
  item,
  isSelected,
  tasks,
  isBusy,
  itemRefImg,
  isGenerating,
  isSpecExtracting,
  isUpscaling,
  isModified,
  currentPrompt,
  activeRefineEntityId,
  refineInput,
  isSubmittingRefine,
  uploadingEntityId,
  getActiveUpscale,
  getSelectedVersionNumber,
  getStableImageSrc,
  getImageGallery,
  onSelect,
  onOpenVersions,
  onEnlargeMedia,
  onTriggerUpload,
  onToggleRefine,
  onRefineInputChange,
  onSubmitRefine,
  onUpscale,
  onExtractSpec,
  onPromptDraftChange,
  onRevertPrompt,
  onGenerate,
  onRetryTask,
}) => {
  const itemId = item.itemId || item.id;
  const imageUrl = item.imageUrl || item.referenceImageUrl;
  const itemTaskStatus = getEntityTaskStatus(tasks, ['film.lookdev', 'film.entity_spec'], {
    itemId,
    id: itemId,
    name: item.name,
  });

  return (
    <div
      onClick={onSelect}
      className={`bg-white/95 border rounded-3xl p-4 shadow-xs flex flex-col cursor-pointer transition-all ${
        isSelected
          ? 'border-indigo-500 ring-4 ring-indigo-500/20 shadow-md bg-indigo-50/20'
          : 'border-slate-200/90 hover:border-indigo-300'
      }`}
    >
      <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/60 mb-3.5 flex items-center justify-center group/img">
        {imageUrl ? (
          <>
            <img
              key={`${imageUrl}_${item.selectedVersionId}`}
              src={getStableImageSrc(imageUrl, item)}
              alt={item.name}
              className="w-full h-full object-contain"
            />
            {item.versions && item.versions.length > 0 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenVersions();
                }}
                className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/65 hover:bg-black/85 backdrop-blur-xs text-white text-[10px] font-mono font-semibold flex items-center space-x-1 cursor-pointer transition-all border border-white/20 z-10"
                title="点击查看并切换历史道具版本"
              >
                <span>v{getSelectedVersionNumber(item)}</span>
                <span className="text-[9px] text-indigo-300 font-sans">({item.versions.length}版)</span>
                {getActiveUpscale(item) && (
                  <span className="ml-0.5 px-1 py-0.2 rounded bg-emerald-500/90 text-white text-[9px] font-bold">
                    HD {getActiveUpscale(item)!.multiplier}×
                  </span>
                )}
              </button>
            ) : (
              getActiveUpscale(item) && (
                <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-emerald-600/90 backdrop-blur-xs text-white text-[10px] font-mono font-bold z-10">
                  HD {getActiveUpscale(item)!.multiplier}×
                </span>
              )
            )}

            {/* 道具右上角放大灯箱入口 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const up = getActiveUpscale(item);
                onEnlargeMedia?.({
                  title: `道具特写 · ${item.name}`,
                  imageUrl: imageUrl,
                  badge: up ? `HD ${up.multiplier}×` : undefined,
                  subtitle: up ? `SeedVR2 ${up.multiplier}× 高清超分道具特写` : undefined,
                  gallery: getImageGallery(item, '道具特写'),
                });
              }}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-xs text-white opacity-0 group-hover/img:opacity-100 transition-opacity text-xs z-10 cursor-pointer"
              title="放大查看原图"
            >
              ⛶
            </button>
          </>
        ) : isSpecExtracting ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-indigo-50/40 animate-pulse">
            <div className="relative w-10 h-10 mb-2 flex items-center justify-center">
              <svg
                className="w-9 h-9 text-indigo-600 animate-spin"
                viewBox="0 0 100 100"
                style={{ animationDuration: '1.2s' }}
              >
                {Array.from({ length: 12 }).map((_, i) => (
                  <rect
                    key={i}
                    x="46.5"
                    y="10"
                    width="7"
                    height="22"
                    rx="3.5"
                    fill="currentColor"
                    opacity={(i + 1) / 12}
                    transform={`rotate(${i * 30} 50 50)`}
                  />
                ))}
              </svg>
              <span className="absolute text-xs">🧰</span>
            </div>
            <span className="text-xs font-bold text-indigo-700">正在推演道具材质...</span>
            <span className="text-[10px] text-slate-400 mt-0.5">解析材质结构与视觉细节</span>
          </div>
        ) : itemTaskStatus.status === 'failed' ? (
          <div className="text-center p-3 text-rose-500 bg-rose-50/50 rounded-xl border border-rose-200/60">
            <span className="text-2xl block mb-1">⚠️</span>
            <span className="text-xs font-bold text-rose-700">特写渲染失败</span>
            <span className="text-[10px] text-rose-600/90 block mt-0.5 line-clamp-2" title={itemTaskStatus.error}>
              {itemTaskStatus.error}
            </span>
          </div>
        ) : (
          <div className="text-center text-slate-400"><span className="text-4xl block mb-2">🧰</span><span className="text-xs font-semibold">待生成道具特写</span></div>
        )}
        {isGenerating && (
          <div className="absolute inset-0 bg-slate-900/65 backdrop-blur-xs flex flex-col items-center justify-center text-white z-10">
            <span className="text-2xl animate-spin mb-2">⏳</span>
            <span className="text-xs font-bold">
              {isUpscaling ? 'SeedVR2 高清超分中...' : '道具渲染中...'}
            </span>
          </div>
        )}
      </div>
      <h3 className="text-sm font-bold text-slate-900">{item.name}</h3>
      <p className="text-[11px] text-slate-500 mt-1 line-clamp-3">{item.description || item.appearanceSummary || '核心剧情道具'}</p>

      {/* 提示词展示与直接编辑区 */}
      <div
        className={`mt-2.5 p-2 rounded-xl flex flex-col transition-all ${
          isModified
            ? 'bg-amber-50/50 border-2 border-amber-300 shadow-2xs'
            : 'bg-slate-50 border border-slate-200/60 hover:border-slate-300'
        }`}
      >
        <div className="text-[10px] font-semibold text-slate-600 mb-1 flex items-center justify-between">
          <span className="flex items-center space-x-1">
            <span>🧰 材质与外观设定</span>
            {isSpecExtracting && (
              <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200/80 px-1.5 py-0.2 rounded-md animate-pulse">
                推演材质中…
              </span>
            )}
          </span>
          <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
            {isModified && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRevertPrompt();
                }}
                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 flex items-center space-x-1 transition cursor-pointer shadow-xs active:scale-95 animate-in fade-in"
                title="放弃当前改动，还原为原始道具设定"
              >
                <span>↺ 还原设定</span>
              </button>
            )}
          </div>
        </div>

        {isSpecExtracting ? (
          <div className="py-2 text-center text-xs text-indigo-600 font-semibold animate-pulse">
            AI 造型师正在精细推演道具材质中...
          </div>
        ) : (
          <textarea
            value={currentPrompt}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onPromptDraftChange(e.target.value)}
            rows={2}
            placeholder="点击直接编辑道具的材质、结构、光泽与陈旧质感..."
            className="w-full text-xs text-slate-700 bg-transparent border-0 rounded-lg p-0 focus:outline-none focus:ring-0 resize-none leading-relaxed placeholder:text-slate-400 select-text"
          />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTriggerUpload();
          }}
          disabled={uploadingEntityId === itemId}
          className="flex-1 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-600 cursor-pointer disabled:opacity-50"
        >
          {uploadingEntityId === itemId ? '上传中...' : '📷 换底图'}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExtractSpec();
          }}
          disabled={isSpecExtracting}
          className="flex-1 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-[11px] font-semibold text-indigo-700 cursor-pointer disabled:opacity-50"
        >
          {isSpecExtracting ? '推演中…' : '✨ 提炼特征'}
        </button>
      </div>

      {imageUrl && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleRefine();
            }}
            className={`flex-1 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer ${
              activeRefineEntityId === itemId
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
            }`}
          >
            🎨 {activeRefineEntityId === itemId ? '收起修改' : '智能微调'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpscale();
            }}
            disabled={isBusy || isGenerating}
            className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold disabled:opacity-50 cursor-pointer transition-all ${
              getActiveUpscale(item)
                ? 'border-emerald-500 bg-emerald-600 text-white shadow-2xs hover:bg-emerald-700'
                : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
            }`}
            title={
              getActiveUpscale(item)
                ? `当前选用版本已完成 ${getActiveUpscale(item)!.multiplier}× 高清超分，点击可重新超分`
                : '使用 SeedVR2 2× 无损高清超分'
            }
          >
            {getActiveUpscale(item) ? `✓ 已超分 ${getActiveUpscale(item)!.multiplier}×` : '✨ 高清超分'}
          </button>
        </div>
      )}

      {activeRefineEntityId === itemId && imageUrl && (
        <div className="mt-2 p-3 rounded-2xl bg-purple-50 border border-purple-200 space-y-2">
          <textarea
            value={refineInput || ''}
            onChange={(e) => onRefineInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmitRefine();
              }
            }}
            rows={2}
            placeholder="输入局部修改，例如：改成银色外壳、去掉裂纹、增加蓝色指示灯"
            className="w-full text-xs text-slate-800 bg-white border border-purple-200 rounded-xl p-2 resize-none focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
          <button
            type="button"
            onClick={onSubmitRefine}
            disabled={isSubmittingRefine || isGenerating || isBusy}
            className="w-full py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            {isSubmittingRefine ? 'AI 构思融合中...' : '定向修改并出图'}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (itemTaskStatus.status === 'failed' && itemTaskStatus.task?.taskId && onRetryTask) {
            onRetryTask(itemTaskStatus.task.taskId);
          } else {
            onGenerate();
          }
        }}
        disabled={isBusy || isGenerating || isSpecExtracting}
        className={`mt-3 w-full py-2 rounded-xl border text-xs font-bold disabled:opacity-50 cursor-pointer transition-all ${
          itemTaskStatus.status === 'failed'
            ? 'bg-rose-50 hover:bg-rose-100 border-rose-300 text-rose-700 shadow-2xs'
            : isModified
            ? 'bg-gradient-to-r from-amber-500 via-indigo-600 to-indigo-700 hover:from-amber-600 hover:to-indigo-800 text-white border border-amber-400 shadow-md active:scale-95'
            : 'bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700'
        }`}
      >
        {isGenerating
          ? '渲染中...'
          : isSpecExtracting
          ? '特征推演中...'
          : itemTaskStatus.status === 'failed'
          ? '↺ 重试生成道具特写'
          : isModified
          ? imageUrl
            ? '✨ 应用修改并重新生成道具'
            : '✨ 应用修改并生成道具'
          : imageUrl
          ? '重新生成道具特写'
          : '生成道具特写'}
      </button>
    </div>
  );
};
