/**
 * client/src/components/studio/stages/visual/components/CharacterCard.tsx
 * 角色视觉定妆卡片 (高内聚深模块 SSOT)
 */

import React from 'react';
import type { TaskRecord } from '../../../../../types/index.js';
import { getEntityTaskStatus } from '../../../../../lib/taskUtils.js';

export interface CharacterCardProps {
  char: any;
  isSelected: boolean;
  tasks?: TaskRecord[];
  isBusy: boolean;
  charRefImg?: string;
  isGen: boolean;
  isSpecExtracting: boolean;
  isModified?: boolean;
  currentPrompt: string;
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
  onGenerate: () => void;
  onRetryTask?: (taskId: string) => void;
  isEntityUpscaling: (type: 'character' | 'location' | 'item', id?: string) => boolean;
}

export const CharacterCard: React.FC<CharacterCardProps> = ({
  char,
  isSelected,
  tasks,
  isBusy,
  charRefImg,
  isGen,
  isSpecExtracting,
  isModified,
  currentPrompt,
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
  onGenerate,
  onRetryTask,
  isEntityUpscaling,
}) => {
  const charId = char.characterId || char.id;
  const charTaskStatus = getEntityTaskStatus(tasks, ['film.lookdev', 'film.entity_spec'], {
    characterId: charId,
    id: charId,
    name: char.name,
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
      {/* 立绘主图 (工业级 2:1 三视图画幅，object-contain 保持正/侧/背三重视角 100% 完整无裁剪) */}
      <div className="relative w-full aspect-[2/1] rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/60 mb-3.5 group/img flex items-center justify-center p-1">
        {char.imageUrl ? (
          <>
            <img
              key={`${char.imageUrl}_${char.selectedVersionId}`}
              src={getStableImageSrc(char.imageUrl, char)}
              alt={char.name}
              className="w-full h-full object-contain object-center group-hover/img:scale-105 transition-transform duration-300"
            />
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-xs text-white text-[10px] font-medium border border-white/20">
              📐 概念三视图 · 正/侧/背
            </div>
            {getActiveUpscale(char) ? (
              <div
                className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-emerald-600/95 backdrop-blur-xs text-white text-[10px] font-mono font-bold shadow-xs border border-emerald-300/40 z-10"
                title={`已通过 SeedVR2 完成 ${getActiveUpscale(char)!.multiplier}× 高清超分`}
              >
                ✨ 已超分 HD {getActiveUpscale(char)!.multiplier}×
              </div>
            ) : hasAnyUpscaledVersion(char) ? (
              <div
                className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-slate-900/80 backdrop-blur-xs text-slate-300 text-[9px] font-sans border border-white/10 z-10"
                title="历史版本库中有已超分版本，点击左上角版本按钮可自由切换"
              >
                历史含HD版
              </div>
            ) : null}
          </>
        ) : charRefImg ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <img
              src={charRefImg}
              alt={`参考底图 · ${char.name}`}
              className="w-full h-full object-contain object-top group-hover/img:scale-105 transition-transform duration-300"
            />
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/65 backdrop-blur-xs text-white text-[10px] font-semibold border border-white/20">
              📷 参考底图 (待定妆)
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
              <span className="absolute text-xs">🎭</span>
            </div>
            <span className="text-xs font-bold text-indigo-700">正在提炼视觉特征...</span>
            <span className="text-[10px] text-slate-400 mt-0.5">解析小传与三视图骨相造型</span>
          </div>
        ) : charTaskStatus.status === 'failed' ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-rose-50/50 border border-rose-200/60 rounded-xl">
            <span className="text-2xl mb-1">⚠️</span>
            <span className="text-xs font-bold text-rose-700">生成中断或失败</span>
            <span className="text-[10px] text-rose-600/90 mt-1 line-clamp-2 px-2" title={charTaskStatus.error}>
              {charTaskStatus.error}
            </span>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4 text-center">
            <span className="text-3xl mb-2">🎭</span>
            <span className="text-xs font-semibold">待生成立绘</span>
            <span className="text-[10px] text-slate-400 mt-1">
              点击下方「生成定妆」立即启动
            </span>
          </div>
        )}

        {/* 生成中/超分中遮罩 */}
        {isGen && (
          <div className="absolute inset-0 bg-slate-900/65 backdrop-blur-xs flex flex-col items-center justify-center text-white z-10">
            <span className="text-2xl animate-spin mb-2">⏳</span>
            <span className="text-xs font-bold">
              {isEntityUpscaling('character', charId) ? 'SeedVR2 高清超分中...' : 'AI 定妆中...'}
            </span>
          </div>
        )}

        {/* 图片左上角：版本库切换入口 */}
        {char.versions && char.versions.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenVersions();
            }}
            className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/65 hover:bg-black/85 backdrop-blur-xs text-white text-[10px] font-mono font-semibold flex items-center space-x-1 cursor-pointer transition-all border border-white/20 z-10"
            title="点击查看并切换历史定妆版本"
          >
            <span>v{getSelectedVersionNumber(char)}</span>
            <span className="text-[9px] text-indigo-300 font-sans">({char.versions.length}版)</span>
            {getActiveUpscale(char) && (
              <span className="ml-0.5 px-1 py-0.2 rounded bg-emerald-500/90 text-white text-[9px] font-bold">
                HD {getActiveUpscale(char)!.multiplier}×
              </span>
            )}
          </button>
        )}

        {/* 图片右上角：放大灯箱入口 */}
        {(char.imageUrl || charRefImg) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const up = getActiveUpscale(char);
              onEnlargeMedia?.({
                title: char.imageUrl ? `角色定妆 · ${char.name}` : `参考底图 · ${char.name}`,
                imageUrl: char.imageUrl || charRefImg,
                badge: up ? `HD ${up.multiplier}×` : undefined,
                subtitle: up ? `SeedVR2 ${up.multiplier}× 高清超分定妆立绘` : undefined,
                gallery: getImageGallery(char, '角色定妆'),
              });
            }}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-xs text-white opacity-0 group-hover/img:opacity-100 transition-opacity text-xs z-10 cursor-pointer"
            title="放大查看原图"
          >
            ⛶
          </button>
        )}

        {/* 参考图微缩胶囊 */}
        {char.imageUrl && charRefImg && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onEnlargeMedia?.({
                title: `参考底图 · ${char.name}`,
                imageUrl: charRefImg,
                gallery: getImageGallery(char, '角色定妆'),
              });
            }}
            className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-black/75 hover:bg-black/90 backdrop-blur-xs text-white text-[10px] flex items-center space-x-1.5 cursor-pointer border border-white/20 shadow-xs z-10"
            title="点击全屏查看参考底图"
          >
            <img
              src={charRefImg}
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
              title="删除参考底图"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* 角色名称与身份简介 */}
      <div className="mb-2.5">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-bold text-slate-900 tracking-tight shrink-0">
            {char.name}
          </h4>
          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 shrink-0">
            {char.role || '主要角色'}
          </span>
        </div>
        {char.identity && (
          <p
            title={char.identity}
            className="text-[11px] text-slate-500 truncate leading-normal"
          >
            {char.identity}
          </p>
        )}
      </div>

      {/* 中文提示词全展开与直接编辑 */}
      <div
        className={`flex-1 rounded-xl p-2.5 mb-3 flex flex-col transition-all ${
          isModified
            ? 'bg-amber-50/50 border-2 border-amber-300 shadow-2xs'
            : 'bg-slate-50 border border-slate-200/70 hover:border-slate-300'
        }`}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-bold text-slate-700 flex items-center space-x-1">
            <span>🎨 角色外观设定</span>
            {isSpecExtracting && (
              <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200/80 px-1.5 py-0.2 rounded-md animate-pulse">
                推演特征中…
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
                title="放弃当前改动，还原为原始设定"
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
                title="重新由 AI 解析剧本并精准推演该角色的视觉规格"
              >
                <span>✨ 提炼特征</span>
              </button>
            )}
          </div>
        </div>

        {isSpecExtracting ? (
          <div className="py-3 px-2 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-indigo-600 font-semibold animate-pulse">
              AI 造型师正在精细推演角色造型中...
            </span>
            <div className="flex items-center space-x-1.5 mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
              <span className="text-[10px] font-semibold text-indigo-600">
                正在生成影视级正向定妆提示词...
              </span>
            </div>
          </div>
        ) : (
          <textarea
            value={currentPrompt}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onPromptDraftChange(e.target.value)}
            rows={3}
            placeholder="点击直接编辑角色的外貌特征、体态骨相、服装穿着与发型配饰..."
            className="w-full text-xs text-slate-700 bg-transparent border-0 rounded-lg p-0 focus:outline-none focus:ring-0 resize-none leading-relaxed placeholder:text-slate-400 select-text"
          />
        )}
      </div>

      {/* 底部操作行动条 */}
      <div className="flex items-center space-x-2 pt-1 border-t border-slate-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTriggerUpload();
          }}
          disabled={uploadingEntityId === charId}
          className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-600 flex items-center space-x-1 transition-colors cursor-pointer"
          title="上传参考底图以控制人脸/服饰一致性"
        >
          <span>{uploadingEntityId === charId ? '上传中...' : '📷 换底图'}</span>
        </button>

        {/* 基于此图修改 & 按需高清超分 (仅当已有立绘时展示) */}
        {char.imageUrl && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleRefine();
              }}
              className={`px-2 py-1.5 rounded-xl border text-[11px] font-bold flex items-center space-x-1 transition-all cursor-pointer ${
                activeRefineEntityId === charId
                  ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                  : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200'
              }`}
              title="基于当前立绘进行图生图定向精修（严格锁定人物五官身材，仅修改衣服/发色/道具）"
            >
              <span>🎨</span>
              <span>{activeRefineEntityId === charId ? '收起' : '微调'}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpscale();
              }}
              disabled={isGen || isBusy}
              className={`px-2 py-1.5 rounded-xl border text-[11px] font-bold flex items-center space-x-1 transition-all disabled:opacity-50 cursor-pointer ${
                getActiveUpscale(char)
                  ? 'border-emerald-500 bg-emerald-600 text-white shadow-2xs hover:bg-emerald-700'
                  : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
              }`}
              title={
                getActiveUpscale(char)
                  ? `当前选用版本已完成 ${getActiveUpscale(char)!.multiplier}× 高清超分，点击可重新超分`
                  : '使用 SeedVR2 2× 无损高清超分，追加高清新版本（保留原版可回切）'
              }
            >
              <span>✨</span>
              <span>{getActiveUpscale(char) ? `已超分 ${getActiveUpscale(char)!.multiplier}×` : '超分'}</span>
            </button>
          </>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            if (charTaskStatus.status === 'failed' && charTaskStatus.task?.taskId && onRetryTask) {
              onRetryTask(charTaskStatus.task.taskId);
            } else {
              onGenerate();
            }
          }}
          disabled={isGen || isBusy || isSpecExtracting}
          className={`flex-1 py-1.5 rounded-xl text-xs font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer ${
            isGen || isBusy || isSpecExtracting
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : charTaskStatus.status === 'failed'
              ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 active:scale-95 shadow-2xs'
              : isModified
              ? 'bg-gradient-to-r from-amber-500 via-indigo-600 to-indigo-700 hover:from-amber-600 hover:to-indigo-800 text-white border border-amber-400 shadow-md active:scale-95'
              : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 active:scale-95'
          }`}
        >
          <span>{charTaskStatus.status === 'failed' ? '↺' : '✨'}</span>
          <span>
            {isGen
              ? '定妆中...'
              : isSpecExtracting
              ? '特征推演中...'
              : charTaskStatus.status === 'failed'
              ? '重试生成'
              : isModified
              ? char.imageUrl
                ? '应用修改并重新定妆'
                : '应用修改并生成定妆'
              : char.imageUrl
              ? '重新定妆'
              : '生成定妆'}
          </span>
        </button>
      </div>

      {/* 展开的基于当前图定向精修面板 */}
      {activeRefineEntityId === charId && (
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
            以当前立绘为基准底模，支持修改任意肢体姿态、面容神情、服饰道具或细节：
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
            placeholder="输入任意修改指令（如：双脚并拢站立、头不要偏目光看前面、换深色风衣、去掉面具、加一道浅伤疤等）..."
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
