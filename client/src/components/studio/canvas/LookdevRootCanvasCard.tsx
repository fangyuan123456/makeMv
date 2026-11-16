/**
 * client/src/components/studio/canvas/LookdevRootCanvasCard.tsx
 * 全剧视觉定妆母体节点卡片 (Lookdev Root Canvas Card SSOT)
 *
 * 作为视听无限画布的唯一母体起点 (Origin Node)：
 * 1. 承载全剧角色的核心立绘与主要场景的视觉基调；
 * 2. 纯视听起点，右侧引线直连第 1 幕分镜；
 * 3. 支持点击深入 (Drill-Down)，进入全剧定妆资产总览。
 */

import React from 'react';
import type { CanvasShotNode } from '../../../types/index.js';

interface LookdevRootCanvasCardProps {
  node: CanvasShotNode;
  isSelected?: boolean;
  onSelect?: () => void;
  onOpenDrillDown?: (node: CanvasShotNode) => void;
}

export const LookdevRootCanvasCard: React.FC<LookdevRootCanvasCardProps> = ({
  node,
  isSelected,
  onSelect,
  onOpenDrillDown,
}) => {
  const characters = node.characters || [];
  const locations = node.locations || [];

  return (
    <div
      onClick={onSelect}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        width: node.size?.w || 340,
      }}
      className={`absolute select-none bg-gradient-to-b from-white to-amber-50/30 rounded-2xl border transition-all duration-200 cursor-move shadow-md hover:shadow-xl ${
        isSelected
          ? 'border-amber-500 ring-2 ring-amber-500/25 z-30'
          : 'border-amber-200/90 z-10 hover:border-amber-300'
      }`}
    >
      {/* 右侧输出连接桩端点 (直连第 1 幕) */}
      <div
        id={`port-out-${node.id}`}
        className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-amber-400 hover:border-amber-600 transition shadow-xs z-20 flex items-center justify-center pointer-events-auto"
        title="视觉定妆输出 (供给全剧分镜)"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
      </div>

      {/* 顶栏：母体身份标识 */}
      <div className="px-3.5 py-2.5 border-b border-amber-100 flex items-center justify-between bg-amber-50/60 rounded-t-2xl">
        <div className="flex items-center space-x-2 truncate">
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
            ROOT
          </span>
          <span className="text-xs font-bold text-slate-900 truncate">
            {node.title || '全剧视觉定妆母体'}
          </span>
        </div>
        <span className="text-[10px] font-medium text-amber-700 bg-amber-100/60 px-1.5 py-0.5 rounded-full">
          视觉基因库
        </span>
      </div>

      {/* 中部：角色立绘与场景预览拼贴 */}
      <div className="p-3.5 space-y-3">
        {/* 角色立绘行 */}
        <div>
          <div className="text-[11px] font-semibold text-slate-600 mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <span>👤</span>
              <span>核心角色立绘 ({characters.length})</span>
            </span>
          </div>
          {characters.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {characters.slice(0, 4).map((c, idx) => (
                <div key={c.characterId || idx} className="flex flex-col items-center">
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 shadow-2xs group relative">
                    {c.imageUrl ? (
                      <img
                        src={c.imageUrl}
                        alt={c.name}
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                        立绘中
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-600 font-medium truncate max-w-[56px] mt-1 text-center">
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2 px-3 bg-amber-50/40 rounded-xl border border-dashed border-amber-200 text-center text-[11px] text-amber-700/80">
              等待定妆角色资产就绪
            </div>
          )}
        </div>

        {/* 场景氛围缩略 */}
        <div>
          <div className="text-[11px] font-semibold text-slate-600 mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <span>🏞️</span>
              <span>主场景基准 ({locations.length})</span>
            </span>
          </div>
          {locations.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {locations.slice(0, 2).map((loc, idx) => (
                <div
                  key={loc.locationId || idx}
                  className="h-14 rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 relative group shadow-2xs"
                >
                  {loc.imageUrl ? (
                    <img
                      src={loc.imageUrl}
                      alt={loc.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                      基准图
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-2xs px-1.5 py-0.5">
                    <p className="text-[9px] text-white truncate font-medium">{loc.name}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2 px-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center text-[11px] text-slate-400">
              暂无场景图
            </div>
          )}
        </div>

        {/* 底栏深入按钮 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDrillDown?.(node);
          }}
          className="w-full py-1.5 px-3 bg-white hover:bg-amber-50/60 text-amber-800 text-xs font-semibold rounded-xl border border-amber-200 transition shadow-2xs flex items-center justify-center gap-1.5 active:scale-98"
        >
          <span>🔍</span>
          <span>递进深入定妆资产</span>
        </button>
      </div>
    </div>
  );
};