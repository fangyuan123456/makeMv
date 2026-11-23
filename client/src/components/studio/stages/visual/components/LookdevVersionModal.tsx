/**
 * client/src/components/studio/stages/visual/components/LookdevVersionModal.tsx
 * 历史定妆版本选择与切换弹窗 (SSOT)
 */

import React from 'react';
import type { LookdevVersion } from '../../../../../types/index.js';

export interface VersionModalEntity {
  type: 'character' | 'location' | 'item';
  id: string;
  name: string;
  currentImageUrl?: string;
  versions: LookdevVersion[];
  selectedVersionId?: string;
}

interface LookdevVersionModalProps {
  entity: VersionModalEntity | null;
  onClose: () => void;
  onSelectVersion: (type: 'character' | 'location' | 'item', id: string, versionId: string) => void;
}

export const LookdevVersionModal: React.FC<LookdevVersionModalProps> = ({
  entity,
  onClose,
  onSelectVersion,
}) => {
  if (!entity) return null;

  const isLocationModal = entity.type === 'location';
  const isItemModal = entity.type === 'item';

  // 严格去重防护，防止脏数据中的重复版本引发 React 调和冲突
  const displayVersions = React.useMemo(() => {
    const list = entity.versions || [];
    const seen = new Set<string>();
    return list.filter((v: any) => {
      const k = v?.versionId || v?.imageUrl;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [entity.versions]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-6 animate-in fade-in duration-200 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-200"
      >
        <div className="p-4 px-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <span className="text-xl">{isLocationModal ? '🏞️' : isItemModal ? '🧰' : '🎨'}</span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isLocationModal ? '选择场景空间版本' : isItemModal ? '选择道具特写版本' : '选择定妆方案版本'} · {entity.name}
              </h3>
              <p className="text-[11px] text-slate-500">
                共{isLocationModal ? '渲染' : '生成'}了 {displayVersions.length} 个版本。待验收版本请先对照修改要求，再点击选用。
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 flex items-center justify-center transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className={`p-6 overflow-y-auto grid ${isLocationModal ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'} gap-4 bg-slate-50/50`}>
          {displayVersions.map((ver, idx) => {
            const isSelected = ver.versionId === entity.selectedVersionId;
            return (
              <div
                key={`${entity.id}_${ver.versionId || 'ver'}_${idx}`}
                onClick={() => {
                  onSelectVersion(entity.type, entity.id, ver.versionId);
                }}
                className={`group relative rounded-2xl overflow-hidden border-2 cursor-pointer transition-all bg-white flex flex-col ${
                  isSelected
                    ? 'border-indigo-600 ring-4 ring-indigo-500/20 shadow-md'
                    : 'border-slate-200 hover:border-indigo-300 shadow-2xs hover:shadow-sm'
                }`}
              >
                <div className={`relative ${isLocationModal ? 'aspect-video' : isItemModal ? 'aspect-square' : 'aspect-[2/1]'} bg-slate-100 flex items-center justify-center ${isLocationModal ? '' : 'p-1'}`}>
                  <img
                    src={`${ver.imageUrl}?t=${ver.versionId}`}
                    alt={`Version ${idx + 1}`}
                    className={`w-full h-full ${isLocationModal ? 'object-cover' : 'object-contain object-center'}`}
                  />
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-xs text-white text-[10px] font-mono font-semibold">
                    v{idx + 1}
                  </div>
                  {ver.upscale && (
                    <div
                      className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-emerald-600/95 backdrop-blur-xs text-white text-[9px] font-mono font-bold shadow-xs border border-emerald-300/40 z-10"
                      title={`已完成 SeedVR2 ${ver.upscale.multiplier}× 高清超分`}
                    >
                      HD {ver.upscale.multiplier}×
                    </div>
                  )}
                  {ver.reviewStatus === 'pending' && (
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-amber-700 text-white text-[10px] font-semibold">待验收</span>
                  )}
                  {isSelected && (
                    <div className="absolute inset-0 bg-indigo-600/15 flex items-center justify-center">
                      <span className="px-2.5 py-1 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-xs">
                        当前选用
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-2.5 bg-white border-t border-slate-100">
                  {ver.reviewStatus === 'pending' && ver.instruction && (
                    <p className="text-[11px] text-slate-700 line-clamp-3 mb-2" title={ver.instruction}>{ver.instruction}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(ver.createdAt).toLocaleDateString()}
                    </span>
                    {isSelected ? (
                      <span className="text-[10px] text-indigo-600 font-bold">✓ 选用中</span>
                    ) : (
                      <span className="text-[10px] text-slate-500 group-hover:text-indigo-600 font-medium">
                        {ver.reviewStatus === 'pending' ? '验收并选用' : '设为当前'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
