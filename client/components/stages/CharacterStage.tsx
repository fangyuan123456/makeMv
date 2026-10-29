'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Users,
  MapPin,
  RefreshCw,
  Save,
  X,
  ChevronLeft,
  ChevronRight,
  Loader,
  AlertCircle,
  ZoomIn,
  Sparkles,
  Edit2,
  Upload,
  Check,
  Trash2,
  Image as ImageIcon,
  CheckCircle2
} from 'lucide-react';
import type { StageViewProps } from './types';
import { assetUrl, assetVersionLabel } from './utils';
import { uploadArtifactImage } from '@/lib/workflowApi';
import StageActions from './StageActions';
import StageProgress from './StageProgress';

import ImageLightbox from './ImageLightbox';
import RewriteResultBadge, { type RewriteResult } from './RewriteResultBadge';

/* ─── 类型定义 ─── */
interface AssetVersion {
  id: string;             // 唯一标识 (character_id / setting_id)
  name: string;
  description: string;
  selected: string;       // 当前选中的文件路径
  versions: string[];     // 所有历史版本路径
  status?: 'pending' | 'done' | 'failed' | 'running';
  rewrite_result?: RewriteResult;
  referenceImageUrl?: string;
  role?: string;
  age?: string;
  personality?: string;
  appearancePrompt?: string;
  clothingPrompt?: string;
  imagePrompt?: string;
  evaluation?: {
    score: number;
    isAcceptable: boolean;
    issues?: string[];
    suggestion?: string;
  };
}

/* ─── 自动撑开无滚动条文本框（避免框内滚动看不全） ─── */
function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${Math.max(68, ref.current.scrollHeight + 10)}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        if (ref.current) {
          ref.current.style.height = 'auto';
          ref.current.style.height = `${Math.max(68, ref.current.scrollHeight + 10)}px`;
        }
        onChange(e.target.value);
      }}
      placeholder={placeholder}
      style={{ fieldSizing: 'content' } as any}
      className={`${className} overflow-hidden resize-none`}
    />
  );
}

/* ─── 角色专属定妆卡片 ─── */
function CharacterCard({
  asset,
  onUpdate,
  onRegenerate,
  onSelectVersion,
  onUploadImage,
  onRemoveReference,
  isStageRunning,
  isRegenerating,
  uploadingState,
  onOpenLightbox,
}: {
  asset: AssetVersion;
  onUpdate: (patch: Partial<AssetVersion>) => void;
  onRegenerate: () => void;
  onSelectVersion: (path: string) => void;
  onUploadImage: (file: File, type: 'final' | 'reference') => void;
  onRemoveReference: () => void;
  isStageRunning?: boolean;
  isRegenerating?: boolean;
  uploadingState?: { id: string; type: 'final' | 'reference' } | null;
  onOpenLightbox: (images: string[], index: number) => void;
}) {
  const isRunning = asset.status === 'running' || isRegenerating;
  const isFailed = asset.status === 'failed' && !isRegenerating;
  const versions = Array.isArray(asset?.versions) ? asset.versions : [];
  const activeImage = asset.selected || versions[0] || '';
  const isUploadingFinal = uploadingState?.id === asset.id && uploadingState?.type === 'final';
  const isUploadingRef = uploadingState?.id === asset.id && uploadingState?.type === 'reference';

  return (
    <div className={`p-5 rounded-2xl border transition-all bg-white shadow-2xs hover:border-violet-300 ${
      isFailed ? 'border-red-200' : 'border-gray-200'
    }`}>
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* 左侧：280px 视觉资产区（定妆图 + 候选版本 + 参考图 + 操作栏） */}
        <div className="w-full lg:w-72 shrink-0 flex flex-col gap-3">
          {/* 成品定妆主图 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                <span>成品定妆照</span>
              </span>
              {activeImage ? (
                <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium border border-emerald-200 flex items-center gap-1">
                  <Check className="w-2.5 h-2.5" /> 已定妆
                </span>
              ) : (
                <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium border border-amber-200">
                  待定妆
                </span>
              )}
            </div>

            {activeImage ? (
              <div className="relative group rounded-xl overflow-hidden border border-gray-200 aspect-[16/10] bg-slate-950 shadow-xs">
                <img
                  src={assetUrl(activeImage)}
                  alt={asset.name}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-2.5">
                  <span className="text-[11px] text-white font-medium bg-emerald-600/80 px-2 py-0.5 rounded backdrop-blur-xs flex items-center gap-1">
                    <Check className="w-3 h-3" /> 当前使用
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const curIdx = versions.indexOf(activeImage);
                      onOpenLightbox(versions.length ? versions : [activeImage], curIdx >= 0 ? curIdx : 0);
                    }}
                    className="text-[11px] text-violet-200 hover:text-white flex items-center gap-1 underline"
                  >
                    <ZoomIn className="w-3 h-3" />
                    放大查看
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border-2 border-dashed border-gray-200 aspect-[16/10] bg-slate-50 flex flex-col items-center justify-center p-3 text-center">
                {isRunning ? (
                  <div className="flex flex-col items-center gap-1 text-violet-600">
                    <Loader className="w-6 h-6 animate-spin" />
                    <span className="text-xs font-medium">正在生成定妆照...</span>
                  </div>
                ) : (
                  <>
                    <ImageIcon className="w-8 h-8 text-gray-300 mb-1.5" />
                    <span className="text-xs font-medium text-gray-400">待生成形象定妆照</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 多选一候选版本条 */}
          {versions.length > 0 && (
            <div className="space-y-1 bg-slate-50 p-2 rounded-xl border border-slate-200/80">
              <div className="flex items-center justify-between text-[11px] text-gray-500 px-0.5">
                <span className="font-semibold text-gray-700">候选定妆版本 ({versions.length})：</span>
                <span className="text-[10px] text-gray-400">点击切换选用</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 py-1">
                {versions.map((vUrl, vIdx) => {
                  const isCurSelected = activeImage === vUrl;
                  return (
                    <button
                      key={vUrl}
                      type="button"
                      onClick={() => onSelectVersion(vUrl)}
                      className={`relative shrink-0 rounded-lg overflow-hidden border aspect-[16/10] w-14 transition-all cursor-pointer ${
                        isCurSelected
                          ? 'ring-2 ring-violet-500 border-violet-500 shadow-xs scale-105'
                          : 'border-gray-200 hover:border-gray-300 opacity-60 hover:opacity-100'
                      }`}
                      title={`点击选用版本 ${vIdx + 1}`}
                    >
                      <img src={assetUrl(vUrl)} alt={`v${vIdx + 1}`} className="w-full h-full object-cover" />
                      {isCurSelected && (
                        <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-violet-600 flex items-center justify-center text-[9px] text-white font-bold">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 成品定妆操作按钮 */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onRegenerate}
              disabled={isRunning || isStageRunning}
              className="py-1.5 px-2 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors shadow-2xs disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              <span>{isRunning ? '生成中...' : activeImage ? '重新AI生成' : 'AI生成'}</span>
            </button>

            <label
              className={`py-1.5 px-2 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors shadow-2xs ${
                isUploadingFinal ? 'opacity-50 cursor-wait' : ''
              }`}
            >
              <Upload className="w-3.5 h-3.5 text-gray-500" />
              <span>{isUploadingFinal ? '上传中...' : '上传成品图'}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={isUploadingFinal}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onUploadImage(file, 'final');
                    e.target.value = '';
                  }
                }}
              />
            </label>
          </div>

          {/* 参考图（垫图 / 视觉锚点）板块 */}
          <div className="pt-2 border-t border-gray-100 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-gray-600">
              <span className="font-semibold flex items-center gap-1 text-gray-700">
                <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                <span>参考图 (生图垫图锚点)</span>
              </span>
              <span className="text-[10px] text-gray-400">引导AI保持形象一致</span>
            </div>

            {asset.referenceImageUrl ? (
              <div className="flex items-center gap-2 p-2 rounded-xl bg-blue-50/40 border border-blue-100">
                <div className="w-12 h-9 rounded-md overflow-hidden shrink-0 border border-blue-200 bg-black">
                  <img src={assetUrl(asset.referenceImageUrl)} alt="参考图" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-blue-900 truncate">已绑定参考图</div>
                  <button
                    type="button"
                    onClick={() => onOpenLightbox([asset.referenceImageUrl!], 0)}
                    className="text-[10px] text-blue-600 hover:underline"
                  >
                    查看大图
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-[11px] text-blue-700 hover:text-blue-900 px-1.5 py-0.5 rounded hover:bg-blue-100/60 cursor-pointer">
                    更换
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={isUploadingRef}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          onUploadImage(f, 'reference');
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={onRemoveReference}
                    className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 cursor-pointer"
                    title="移除参考图"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ) : (
              <label
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-dashed border-blue-200 bg-blue-50/30 hover:bg-blue-50 hover:border-blue-300 text-blue-700 text-xs font-medium cursor-pointer transition-colors ${
                  isUploadingRef ? 'opacity-50 cursor-wait' : ''
                }`}
              >
                <Upload className="w-3.5 h-3.5 text-blue-500" />
                <span>{isUploadingRef ? '上传参考图中...' : '+ 上传参考图 (真人/原画)'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={isUploadingRef}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      onUploadImage(f, 'reference');
                      e.target.value = '';
                    }
                  }}
                />
              </label>
            )}
          </div>
        </div>

        {/* 右侧：档案全景（姓名角色 + 3列直接编辑文本区） */}
        <div className="flex-1 min-w-0 w-full space-y-3.5">
          {/* 顶部：角色名与定位（直接可编辑） */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
              <RewriteResultBadge rewriteResult={asset.rewrite_result} />
              {asset.evaluation && (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 border shrink-0 ${
                    asset.evaluation.isAcceptable
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}
                  title={asset.evaluation.suggestion || (asset.evaluation.issues?.join('; ') || 'AI视觉质检验收完成')}
                >
                  <span>{asset.evaluation.isAcceptable ? '✓' : '⚠️'}</span>
                  <span>质检 {asset.evaluation.score}分</span>
                </span>
              )}
              <Users className="w-4 h-4 text-violet-500 shrink-0" />
              <input
                value={asset.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                size={Math.max(4, asset.name.length + 1)}
                style={{ fieldSizing: 'content' } as any}
                className="font-bold text-base sm:text-lg text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-violet-500 focus:bg-white outline-none px-1 rounded transition-colors"
                placeholder="角色名称"
              />
              <div className="flex items-center gap-1.5 text-xs text-gray-700 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs">
                <span className="text-gray-400 font-medium shrink-0">定位:</span>
                <input
                  value={asset.role || ''}
                  onChange={(e) => onUpdate({ role: e.target.value })}
                  size={Math.max(8, (asset.role || '').length + 1)}
                  style={{ fieldSizing: 'content' } as any}
                  className="bg-transparent border-0 outline-none text-xs text-gray-800 font-medium min-w-[80px] max-w-full focus:bg-white focus:ring-1 focus:ring-violet-400 rounded px-1 transition-all"
                  placeholder="角色定位/身份"
                />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-700 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs">
                <span className="text-gray-400 font-medium shrink-0">时代/年龄:</span>
                <input
                  value={asset.age || ''}
                  onChange={(e) => onUpdate({ age: e.target.value })}
                  size={Math.max(8, (asset.age || '').length + 1)}
                  style={{ fieldSizing: 'content' } as any}
                  className="bg-transparent border-0 outline-none text-xs text-gray-800 font-medium min-w-[80px] max-w-full focus:bg-white focus:ring-1 focus:ring-violet-400 rounded px-1 transition-all"
                  placeholder="时代或年龄"
                />
              </div>
            </div>
          </div>

          {/* 档案文本区：全展开展平显示，高度自适应，无需滚动条 */}
          <div className="space-y-3 pt-1">
            {/* 上排两列：外貌体态 + 性格特质 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* 外貌体态 */}
              <div className="space-y-1.5 p-3 rounded-xl bg-slate-50/80 border border-slate-200/80 flex flex-col">
                <span className="text-xs font-bold text-gray-700 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    外貌与体态特征
                  </span>
                  <span className="text-[10px] text-gray-400 font-normal">直接可编辑</span>
                </span>
                <AutoResizeTextarea
                  value={asset.appearancePrompt || asset.description || ''}
                  onChange={(val) => onUpdate({ appearancePrompt: val, description: val })}
                  placeholder="输入角色的具体外貌特征、骨骼体态、肤色或鳞甲质感..."
                  className="w-full text-xs text-gray-800 bg-white border border-gray-200 rounded-lg p-2.5 outline-none focus:ring-1 focus:ring-blue-400 leading-relaxed"
                />
              </div>

              {/* 性格特质 */}
              <div className="space-y-1.5 p-3 rounded-xl bg-slate-50/80 border border-slate-200/80 flex flex-col">
                <span className="text-xs font-bold text-gray-700 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                    性格特质与行动逻辑
                  </span>
                  <span className="text-[10px] text-gray-400 font-normal">直接可编辑</span>
                </span>
                <AutoResizeTextarea
                  value={asset.personality || ''}
                  onChange={(val) => onUpdate({ personality: val })}
                  placeholder="输入角色的性格、动机与行为模式..."
                  className="w-full text-xs text-gray-800 bg-white border border-gray-200 rounded-lg p-2.5 outline-none focus:ring-1 focus:ring-purple-400 leading-relaxed"
                />
              </div>
            </div>

            {/* 下排整行：AI生图提示词 (Prompt)，宽度开阔完整展示无折叠 */}
            <div className="space-y-1.5 p-3 rounded-xl bg-slate-50/80 border border-violet-100 flex flex-col">
              <span className="text-xs font-bold text-gray-700 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-violet-500"></span>
                  AI 生图提示词 (Prompt)
                </span>
                <span className="text-[10px] text-violet-600 font-medium">直接影响生图 · 完整展开</span>
              </span>
              <AutoResizeTextarea
                value={asset.imagePrompt || ''}
                onChange={(val) => onUpdate({ imagePrompt: val })}
                placeholder="输入或微调该角色生图所用的详细英文 Prompt..."
                className="w-full text-xs text-gray-800 bg-white border border-violet-200 rounded-lg p-2.5 outline-none focus:ring-1 focus:ring-violet-400 font-mono leading-relaxed"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── 主工作台组件 ─── */
export default function CharacterStage({
  state,
  sessionId,
  onConfirm,
  onIntervene,
  onRegenerate,
  onUpdateArtifact,
  onSaveSelections,
  showConfirm,
  isRunning,
  hasPendingItems,
  hasNextStageStarted,
}: StageViewProps) {
  const normalizeAsset = useCallback((item: any): AssetVersion => {
    const selected = item.selected || item.imageUrl || item.image_url || '';
    const versions = Array.isArray(item.versions) && item.versions.length > 0
      ? item.versions
      : (selected ? [selected] : []);
    return {
      id: item.id || '',
      name: item.name || item.location || '',
      description: item.description || item.personality || item.appearancePrompt || item.atmospherePrompt || '',
      selected,
      versions,
      status: item.status || (selected ? 'done' : 'pending'),
      rewrite_result: item.rewrite_result,
      referenceImageUrl: item.referenceImageUrl || '',
      role: item.role || '',
      age: item.age || item.era || '',
      personality: item.personality || '',
      appearancePrompt: item.appearancePrompt || '',
      clothingPrompt: item.clothingPrompt || '',
      imagePrompt: item.imagePrompt || '',
      evaluation: item.evaluation,
    };
  }, []);

  const rawCharacters: AssetVersion[] = useMemo(() => {
    const list = state.artifact?.characters || [];
    return list.map(normalizeAsset);
  }, [state.artifact?.characters, normalizeAsset]);

  const [charactersDraft, setCharactersDraft] = useState<AssetVersion[]>(rawCharacters);
  const charactersDraftRef = useRef<AssetVersion[]>(rawCharacters);
  charactersDraftRef.current = charactersDraft;

  const lastRawCharactersRef = useRef<any>(state.artifact?.characters);

  useEffect(() => {
    if (state.artifact?.characters && state.artifact.characters !== lastRawCharactersRef.current) {
      lastRawCharactersRef.current = state.artifact.characters;
      const normalized = state.artifact.characters.map(normalizeAsset);
      setCharactersDraft(normalized);
      charactersDraftRef.current = normalized;
    }
  }, [state.artifact?.characters, normalizeAsset]);

  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [uploadingState, setUploadingState] = useState<{ id: string; type: 'final' | 'reference' } | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('saved');
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 灯箱预览控制
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // 统计角色定妆完成度
  const charsReadyCount = useMemo(() => {
    return charactersDraft.filter((c) => Boolean(c.selected)).length;
  }, [charactersDraft]);

  // 门禁：所有角色必须完成定妆（有 approved image）方可确认进入分集创作
  const allCharactersReady = useMemo(() => {
    return charactersDraft.length > 0 && charactersDraft.every((c) => Boolean(c.selected));
  }, [charactersDraft]);

  const handleOpenLightbox = (images: string[], index: number) => {
    setLightboxImages(images);
    setLightboxIndex(index);
  };

  // 直接编辑并防抖持久化角色档案
  const handleUpdateCharacter = useCallback((id: string, patch: Partial<AssetVersion>) => {
    setCharactersDraft((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
      charactersDraftRef.current = next;
      return next;
    });

    setAutoSaveStatus('saving');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const updated = charactersDraftRef.current;
      try {
        await fetch(`/api/project/${sessionId}/artifact/character_design`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characters: updated }),
        });
        onUpdateArtifact?.({ characters: updated });
        setAutoSaveStatus('saved');
      } catch (err) {
        console.error('自动保存角色档案失败:', err);
        setAutoSaveStatus('idle');
      }
    }, 600);
  }, [sessionId, onUpdateArtifact]);

  // 单项重新生成
  const handleRegenerate = (id: string) => {
    setRegeneratingIds((prev) => new Set(prev).add(id));
    onIntervene({ regenerate_characters: [id] });
  };

  // 一键生成全部未完成角色定妆
  const handleGenerateAllMissingCharacters = () => {
    const missingIds = charactersDraft.filter((c) => !c.selected).map((c) => c.id);
    if (!missingIds.length) {
      // 若都已生成，则全部重新生成
      onIntervene({ regenerate_characters: charactersDraft.map((c) => c.id) });
    } else {
      onIntervene({ regenerate_characters: missingIds });
    }
  };

  // 选用不同版本 (多选一)
  const handleSelectCharVersion = async (id: string, path: string) => {
    handleUpdateCharacter(id, { selected: path });
    if (onSaveSelections) {
      const selections: Record<string, string> = {};
      charactersDraftRef.current.forEach((c) => {
        selections[c.id] = c.id === id ? path : (c.selected || '');
      });
      selections[id] = path;
      try {
        await onSaveSelections(selections);
      } catch (e) {
        console.error('保存选择失败:', e);
      }
    }
  };

  const handleSaveAllSelections = useCallback(async () => {
    if (!onSaveSelections) return;
    const selections: Record<string, string> = {};
    charactersDraftRef.current.forEach((c) => { selections[c.id] = c.selected || ''; });
    await onSaveSelections(selections);
  }, [onSaveSelections]);

  // 图片上传（支持区分 reference 和 final）
  const handleUploadImage = async (
    id: string,
    file: File,
    itemType: 'final' | 'reference' = 'final'
  ) => {
    setUploadingState({ id, type: itemType });
    try {
      const result = await uploadArtifactImage(sessionId, 'character_design', itemType, id, file);
      const artifact = result.artifact;
      if (artifact?.characters) {
        const normalized = artifact.characters.map(normalizeAsset);
        setCharactersDraft(normalized);
        charactersDraftRef.current = normalized;
        onUpdateArtifact?.({ characters: artifact.characters });
      }
    } catch (error) {
      console.error('上传图片失败:', error);
      alert('上传图片失败，请重试');
    } finally {
      setUploadingState(null);
    }
  };

  // 移除参考图
  const handleRemoveReferenceImage = (id: string) => {
    handleUpdateCharacter(id, { referenceImageUrl: '' });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 space-y-6">
        {/* 顶部标题与阶段统计控制 */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center font-bold">
                <Users className="w-4 h-4" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">角色视觉定妆工作台</h2>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              第二步为全剧核心角色确立统一视觉资产；支持 AI 概念生图、参考图（垫图）引导、成品图上传及版本多选一。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 ${
                allCharactersReady
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                {allCharactersReady ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                角色定妆：{charsReadyCount} / {charactersDraft.length}
              </span>
            </div>

            <button
              type="button"
              onClick={handleGenerateAllMissingCharacters}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 shadow-sm transition-all cursor-pointer"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              <span>{allCharactersReady ? '🎨 一键重新定妆全部角色' : '🎨 一键定妆所有未就绪角色'}</span>
            </button>
          </div>
        </div>

        {/* 运行中进度 */}
        {state.status === 'running' && (
          <StageProgress
            message={state.progressMessage}
            fallback="正在生成角色概念设定..."
            progress={state.progress}
            color="violet"
          />
        )}

        {/* 错误提示 */}
        {state.error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-4 rounded-xl">
            {state.error}
          </div>
        )}

        {/* 门禁锁定提示 */}
        {!allCharactersReady && charactersDraft.length > 0 && (
          <div className="flex items-center gap-2.5 p-3.5 bg-amber-50/90 border border-amber-200 rounded-xl text-amber-800 text-xs shadow-2xs">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <div className="leading-relaxed">
              <strong>角色定妆门禁：</strong>
              为了保证后续分集剧本描写与分镜画面的角色一致性，<strong>必须完成所有角色的定妆照（生成或上传）</strong>。
              当前已就绪：{charsReadyCount} / {charactersDraft.length}。
            </div>
          </div>
        )}

        {/* ═══ 核心角色定妆列表 ═══ */}
        {charactersDraft.length > 0 && (
          <section className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-600" />
                <h3 className="text-sm font-bold text-gray-900">核心角色视觉定妆 ({charactersDraft.length})</h3>
              </div>
              <span className="text-xs text-emerald-600 font-medium">所有角色档案（姓名、定位、外貌、性格、AI 生图 Prompt）均可直接输入编辑并自动保存</span>
            </div>

            <div className="space-y-4">
              {charactersDraft.map((asset) => (
                <CharacterCard
                  key={asset.id}
                  asset={asset}
                  onUpdate={(patch) => handleUpdateCharacter(asset.id, patch)}
                  onRegenerate={() => handleRegenerate(asset.id)}
                  onSelectVersion={(path) => handleSelectCharVersion(asset.id, path)}
                  onUploadImage={(file, type) => handleUploadImage(asset.id, file, type)}
                  onRemoveReference={() => handleRemoveReferenceImage(asset.id)}
                  isStageRunning={state.status === 'running'}
                  isRegenerating={regeneratingIds.has(asset.id)}
                  uploadingState={uploadingState}
                  onOpenLightbox={handleOpenLightbox}
                />
              ))}
            </div>
          </section>
        )}



        {state.status === 'pending' && (
          <div className="text-center text-gray-400 text-sm py-20">等待上一阶段大纲确认...</div>
        )}
      </div>

      {/* 图片放大灯箱 */}
      {lightboxIndex !== null && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {/* 底部操作栏（受定妆门禁控制） */}
      <StageActions
        status={state.status}
        onConfirm={onConfirm}
        showConfirm={showConfirm}
        onRegenerate={onRegenerate}
        onSaveSelections={onSaveSelections ? handleSaveAllSelections : undefined}
        stageId="character_design"
        hasPendingItems={hasPendingItems}
        hasNextStageStarted={hasNextStageStarted}
        isRunning={isRunning}
        disabledConfirm={!allCharactersReady}
        disabledConfirmMessage="需完成所有角色的定妆图生成或上传，方可确认进入分集剧本创作"
        autoSaveStatus={autoSaveStatus}
      />
    </div>
  );
}
