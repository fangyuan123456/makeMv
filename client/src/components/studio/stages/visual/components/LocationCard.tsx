/**
 * client/src/components/studio/stages/visual/components/LocationCard.tsx
 * 场景空间视觉展台卡片 (高内聚深模块 SSOT)
 */

import React from 'react';
import type { TaskRecord } from '../../../../../types/index.js';
import { getEntityTaskStatus } from '../../../../../lib/taskUtils.js';

export interface LocationCardProps {
  loc: any;
  isSelected: boolean;
  tasks?: TaskRecord[];
  isBusy: boolean;
  locRefImg?: string;
  isGen: boolean;
  isSpecExtracting: boolean;
  isModified?: boolean;
  currentPrompt: string;
  currentSpatial?: string;
  isSpatialModified?: boolean;
  activeRefineEntityId: string | null;
  refineInput: string;
  isSubmittingRefine: boolean;
  uploadingEntityId: string | null;
  getActiveUpscale: (entity: any) => { multiplier: number } | undefined;
  hasAnyUpscaledVersion: (entity: any) => boolean;
  getSelectedVersionNumber: (entity: any) => number;
  getStableImageSrc: (url: string, entity: any) => string;
  getImageGallery: (entity: any, titlePrefix: string) => any[];
  onSelect: () => void;
  onOpenVersions: () => void;
  onEnlargeMedia?: (media: any) => void;
  onRemoveRefImage: () => void;
  onTriggerUpload: () => void;
  onToggleRefine: () => void;
  onRefineInputChange: (val: string) => void;
  onSubmitRefine: () => void;
  onCancelRefine: () => void;
  onUpscale: () => void;
  onExtractSpec: () => void;
  onPromptDraftChange: (val: string) => void;
  onRevertPrompt: () => void;
  onSpatialDraftChange?: (val: string) => void;
  onRevertSpatial?: () => void;
  onGenerate: () => void;
  onRetryTask?: (taskId: string) => void;
  isEntityUpscaling: (type: 'character' | 'location' | 'item', id?: string) => boolean;
}

export const LocationCard: React.FC<LocationCardProps> = ({
  loc,
  isSelected,
  tasks,
  isBusy,
  locRefImg,
  isGen,
  isSpecExtracting,
  isModified,
  currentPrompt,
  currentSpatial,
  isSpatialModified,
  activeRefineEntityId,
  refineInput,
  isSubmittingRefine,
  uploadingEntityId,
  getActiveUpscale,
  hasAnyUpscaledVersion,
  getSelectedVersionNumber,
  getStableImageSrc,
  getImageGallery,
  onSelect,
  onOpenVersions,
  onEnlargeMedia,
  onRemoveRefImage,
  onTriggerUpload,
  onToggleRefine,
  onRefineInputChange,
  onSubmitRefine,
  onCancelRefine,
  onUpscale,
  onExtractSpec,
  onPromptDraftChange,
  onRevertPrompt,
  onSpatialDraftChange,
  onRevertSpatial,
  onGenerate,
  onRetryTask,
  isEntityUpscaling,
}) => {
  const locId = loc.locationId || loc.id;
  const locTaskStatus = getEntityTaskStatus(tasks, ['film.lookdev', 'film.entity_spec'], {
    locationId: locId,
    id: locId,
    name: loc.name,
  });

  return (
    <div
      onClick={onSelect}
      className={`bg-white/95 backdrop-blur-xs border rounded-3xl p-4 transition-all flex flex-col group cursor-pointer ${
        isSelected
          ? 'border-indigo-500 ring-4 ring-indigo-500/20 shadow-md bg-indigo-50/20'
          : 'border-slate-200/90 hover:border-indigo-300 shadow-xs hover:shadow-md'
      }`}
    >
      {/* 场景氛围主图 (16:9 画幅) */}
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/60 mb-3.5 group/img">
        {loc.imageUrl ? (
          <>
            <img
              key={`${loc.imageUrl}_${loc.selectedVersionId}`}
              src={getStableImageSrc(loc.imageUrl, loc)}
              alt={loc.name}
              className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-300"
            />
            {getActiveUpscale(loc) ? (
              <div
                className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-emerald-600/95 backdrop-blur-xs text-white text-[10px] font-mono font-bold shadow-xs border border-emerald-300/40 z-10"
                title={`已通过 SeedVR2 完成 ${getActiveUpscale(loc)!.multiplier}× 高清超分`}
              >
                ✨ 已超分 HD {getActiveUpscale(loc)!.multiplier}×
              </div>
            ) : hasAnyUpscaledVersion(loc) ? (
              <div
                className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-slate-900/80 backdrop-blur-xs text-slate-300 text-[9px] font-sans border border-white/10 z-10"
                title="历史版本库中有已超分版本，点击左上角版本按钮可自由切换"
              >
                历史含HD版
              </div>
            ) : null}
          </>
        ) : locRefImg ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <img
              src={locRefImg}
              alt={`参考底图 · ${loc.name}`}
              className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-300"
            />
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/65 backdrop-blur-xs text-white text-[10px] font-semibold border border-white/20">
              📷 参考底图 (待渲染)
            </div>
          </div>
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
              <span className="absolute text-xs">🏞️</span>
            </div>
            <span className="text-xs font-bold text-indigo-700">正在推演空间置景...</span>
            <span className="text-[10px] text-slate-400 mt-0.5">构想建筑结构与光影影调</span>
          </div>
        ) : locTaskStatus.status === 'failed' ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-rose-50/50 border border-rose-200/60 rounded-xl">
            <span className="text-2xl mb-1">⚠️</span>
            <span className="text-xs font-bold text-rose-700">渲染中断或失败</span>
            <span className="text-[10px] text-rose-600/90 mt-1 line-clamp-2 px-2" title={locTaskStatus.error}>
              {locTaskStatus.error}
            </span>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4 text-center">
            <span className="text-3xl mb-1.5">🏞️</span>
            <span className="text-xs font-semibold">待生成场景氛围图</span>
          </div>
        )}

        {/* 生成中/超分中遮罩 */}
        {isGen && (
          <div className="absolute inset-0 bg-slate-900/65 backdrop-blur-xs flex flex-col items-center justify-center text-white z-10">
            <span className="text-2xl animate-spin mb-2">⏳</span>
            <span className="text-xs font-bold">
              {isEntityUpscaling('location', locId) ? 'SeedVR2 高清超分中...' : '场景渲染中...'}
            </span>
          </div>
        )}

        {/* 场景左上角：版本库切换入口 */}
        {loc.versions && loc.versions.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenVersions();
            }}
            className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/65 hover:bg-black/85 backdrop-blur-xs text-white text-[10px] font-mono font-semibold flex items-center space-x-1 cursor-pointer transition-all border border-white/20 z-10"
            title="点击查看并切换历史场景氛围版本"
          >
            <span>v{getSelectedVersionNumber(loc)}</span>
            <span className="text-[9px] text-indigo-300 font-sans">({loc.versions.length}版)</span>
            {getActiveUpscale(loc) && (
              <span className="ml-0.5 px-1 py-0.2 rounded bg-emerald-500/90 text-white text-[9px] font-bold">
                HD {getActiveUpscale(loc)!.multiplier}×
              </span>
            )}
          </button>
        )}

        {/* 场景右上角：放大灯箱入口 */}
        {(loc.imageUrl || locRefImg) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const up = getActiveUpscale(loc);
              onEnlargeMedia?.({
                title: loc.imageUrl ? `场景氛围 · ${loc.name}` : `场景参考底图 · ${loc.name}`,
                imageUrl: loc.imageUrl || locRefImg,
                badge: up ? `HD ${up.multiplier}×` : undefined,
                subtitle: up ? `SeedVR2 ${up.multiplier}× 高清超分场景氛围图` : undefined,
                gallery: getImageGallery(loc, '场景氛围'),
              });
            }}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-xs text-white opacity-0 group-hover/img:opacity-100 transition-opacity text-xs z-10 cursor-pointer"
            title="放大查看原图"
          >
            ⛶
          </button>
        )}

        {/* 场景参考图微缩胶囊 */}
        {loc.imageUrl && locRefImg && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onEnlargeMedia?.({
                title: `场景参考底图 · ${loc.name}`,
                imageUrl: locRefImg,
                gallery: getImageGallery(loc, '场景氛围'),
              });
            }}
            className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-black/75 hover:bg-black/90 backdrop-blur-xs text-white text-[10px] flex items-center space-x-1.5 cursor-pointer border border-white/20 shadow-xs z-10"
            title="点击全屏查看场景参考底图"
          >
            <img
              src={locRefImg}
              alt="底图"
              className="w-4 h-4 rounded-full object-cover border border-white/60 shrink-0"
            />
            <span className="font-medium text-slate-200">参考底图</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onRemoveRefImage();
              }}
              className="w-4 h-4 rounded-full bg-black/50 hover:bg-rose-600 text-white flex items-center justify-center transition cursor-pointer text-[10px] ml-0.5 shadow-2xs"
              title="删除场景参考底图"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* 场景名称与简短定位 */}
      <div className="mb-2.5">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-bold text-slate-900 tracking-tight shrink-0">
            {loc.name}
          </h4>
          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 shrink-0">
            场景空间
          </span>
        </div>
        {(loc.appearanceSummary || loc.atmosphere) && (
          <p
            title={loc.appearanceSummary || loc.atmosphere}
            className="text-[11px] text-slate-500 truncate leading-normal"
          >
            {loc.appearanceSummary || loc.atmosphere}
          </p>
        )}
      </div>

      {/* 字段 1：场景生图词 (出图专用) */}
      <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-2.5 mb-2 flex flex-col">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-bold text-slate-700 flex items-center space-x-1">
            <span>🎨 场景生图词</span>
            <span className="text-[9px] text-slate-400 font-normal">(出图专用)</span>
            {isSpecExtracting && (
              <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200/80 px-1.5 py-0.2 rounded-md animate-pulse">
                推演置景中…
              </span>
            )}
          </span>
          <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
            {isModified ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRevertPrompt();
                }}
                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 flex items-center space-x-1 transition cursor-pointer shadow-xs active:scale-95 animate-in fade-in"
                title="放弃当前改动，还原为原始置景设定"
              >
                <span>↺ 还原设定</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onExtractSpec();
                }}
                disabled={isSpecExtracting || isBusy}
                className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center space-x-0.5 transition cursor-pointer disabled:opacity-50"
                title="重新由 AI 解析剧本并精准推演该场景的空间架构与影调"
              >
                <span>✨ 提炼置景</span>
              </button>
            )}
          </div>
        </div>

        {isSpecExtracting ? (
          <div className="py-3 px-2 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-indigo-600 font-semibold animate-pulse">
              AI 空间大师正在构想场景空间与影调...
            </span>
            <div className="flex items-center space-x-1.5 mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
              <span className="text-[10px] font-semibold text-indigo-600">
                正在生成空间光影与置景设定提示词...
              </span>
            </div>
          </div>
        ) : (
          <textarea
            value={currentPrompt}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onPromptDraftChange(e.target.value)}
            rows={3}
            placeholder="点击直接编辑场景的空间光影、色彩影调、建筑陈设与氛围..."
            className="w-full text-xs text-slate-700 bg-transparent border-0 rounded-lg p-0 focus:outline-none focus:ring-0 resize-none leading-relaxed placeholder:text-slate-400 select-text"
          />
        )}
      </div>

      {/* 字段 2：三维空间构造 (分镜机位调度专用，直接可编辑) */}
      <div
        className={`rounded-xl p-2.5 mb-3 text-[11px] flex flex-col transition-all ${
          isSpatialModified
            ? 'bg-amber-50/50 border-2 border-amber-300 shadow-2xs'
            : 'bg-indigo-50/40 border border-indigo-100 hover:border-indigo-200'
        }`}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-bold text-indigo-900 flex items-center space-x-1">
            <span>🧭 三维空间构造</span>
            <span className="text-[9px] text-indigo-500 font-normal">(分镜机位专用)</span>
          </span>
          <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
            {isSpatialModified ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRevertSpatial?.();
                }}
                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 flex items-center space-x-1 transition cursor-pointer shadow-xs active:scale-95 animate-in fade-in"
                title="放弃空间构造改动，还原为原始设定"
              >
                <span>↺ 还原空间构造</span>
              </button>
            ) : loc.spatialLayout ? (
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-700 font-mono">
                已对齐相对拓扑
              </span>
            ) : (
              <span className="text-[9px] text-indigo-400 font-normal">
                未推演
              </span>
            )}
          </div>
        </div>
        <textarea
          value={currentSpatial ?? ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSpatialDraftChange?.(e.target.value)}
          rows={3}
          placeholder="标准五段式收束：【入场路径】... 【核心地标】... 【画左立面】... 【画右立面】... 【背景阻隔】..."
          className="w-full text-xs text-slate-700 bg-transparent border-0 rounded-lg p-0 focus:outline-none focus:ring-0 resize-none leading-relaxed placeholder:text-slate-400 select-text font-sans"
        />
      </div>

      {/* 底部按钮 */}
      <div className="flex items-center space-x-2 pt-1 border-t border-slate-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTriggerUpload();
          }}
          disabled={uploadingEntityId === locId}
          className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-600 flex items-center space-x-1 transition-colors cursor-pointer"
          title="上传参考底图以控制空间构图与风格一致性"
        >
          <span>{uploadingEntityId === locId ? '上传中...' : '📷 换底图'}</span>
        </button>

        {loc.imageUrl && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleRefine();
              }}
              className={`px-2 py-1.5 rounded-xl border text-[11px] font-bold flex items-center space-x-1 transition-all cursor-pointer ${
                activeRefineEntityId === locId
                  ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                  : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200'
              }`}
              title="基于当前场景进行图生图定向精修"
            >
              <span>🎨</span>
              <span>{activeRefineEntityId === locId ? '收起' : '微调'}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpscale();
              }}
              disabled={isGen || isBusy}
              className={`px-2 py-1.5 rounded-xl border text-[11px] font-bold flex items-center space-x-1 transition-all disabled:opacity-50 cursor-pointer ${
                getActiveUpscale(loc)
                  ? 'border-emerald-500 bg-emerald-600 text-white shadow-2xs hover:bg-emerald-700'
                  : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
              }`}
              title={
                getActiveUpscale(loc)
                  ? `当前选用版本已完成 ${getActiveUpscale(loc)!.multiplier}× 高清超分，点击可重新超分`
                  : '使用 SeedVR2 2× 无损高清超分，追加高清新版本（保留原版可回切）'
              }
            >
              <span>✨</span>
              <span>{getActiveUpscale(loc) ? `已超分 ${getActiveUpscale(loc)!.multiplier}×` : '超分'}</span>
            </button>
          </>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            if (locTaskStatus.status === 'failed' && locTaskStatus.task?.taskId && onRetryTask) {
              onRetryTask(locTaskStatus.task.taskId);
            } else {
              onGenerate();
            }
          }}
          disabled={isGen || isBusy || isSpecExtracting}
          className={`flex-1 py-1.5 rounded-xl text-xs font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer ${
            isGen || isBusy || isSpecExtracting
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : locTaskStatus.status === 'failed'
              ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 active:scale-95 shadow-2xs'
              : (isModified || isSpatialModified)
              ? 'bg-gradient-to-r from-amber-500 via-indigo-600 to-indigo-700 hover:from-amber-600 hover:to-indigo-800 text-white border border-amber-400 shadow-md active:scale-95'
              : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 active:scale-95'
          }`}
        >
          <span>{locTaskStatus.status === 'failed' ? '↺' : '✨'}</span>
          <span>
            {isGen
              ? '渲染中...'
              : isSpecExtracting
              ? '特征推演中...'
              : locTaskStatus.status === 'failed'
              ? '重试生成'
              : (isModified || isSpatialModified)
              ? loc.imageUrl
                ? '应用修改并重新渲染场景'
                : '应用修改并渲染场景'
              : loc.imageUrl
              ? '重新渲染'
              : '生成场景'}
          </span>
        </button>
      </div>

      {/* 展开的基于当前场景定向精修面板 */}
      {activeRefineEntityId === locId && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-2.5 p-3 rounded-2xl bg-gradient-to-br from-purple-50/95 to-indigo-50/90 border border-purple-200 shadow-xs space-y-2 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-purple-950 flex items-center space-x-1">
              <span>🎨</span>
              <span>多模态通用定向精修</span>
            </span>
            <span className="text-[10px] text-purple-600 font-mono">
              动态差分解耦
            </span>
          </div>
          <p className="text-[10px] text-purple-700 leading-tight">
            以当前场景为基准底模，支持修改任意空间布局、天气光影、建筑构件或时空氛围：
          </p>
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
            placeholder="输入任意修改指令（如：变成暴雨倾盆的黑夜、换成黄昏暖色夕阳、增加霓虹招牌等）..."
            className="w-full text-xs text-slate-800 bg-white border border-purple-200 rounded-xl p-2 focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:text-slate-400 resize-none shadow-2xs font-sans"
          />
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[10px] text-purple-600">Enter 回车即刻出图</span>
            <div className="flex items-center space-x-1.5">
              <button
                onClick={onCancelRefine}
                className="px-2 py-1 rounded-lg text-[11px] text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transition cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={onSubmitRefine}
                disabled={isSubmittingRefine || isGen || isBusy}
                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs flex items-center space-x-1 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                <span>🎨</span>
                <span>
                  {isSubmittingRefine ? 'AI 构思融合中...' : '定向修改并出图'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
