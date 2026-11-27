/**
 * client/src/components/studio/canvas/EntityMentionText.tsx
 * 实体资产 @ 语义高亮与 Hover 定妆预览呈现组件 (Entity Mention Text & Image Tooltip SSOT)
 *
 * 核心特性：
 * 1. 纯 UI 呈现组件，底层语义解析器统一收敛至 `client-semantic-parser.ts`；
 * 2. 接收纯文本，视图层自动将匹配到的实体渲染为高亮 `@实体名` 实体胶囊；
 * 3. 鼠标悬停 (Hover 120ms) 浮现高清定妆大图与空间构造蓝图。
 */

import React, { useState, useMemo, useRef } from 'react';
import {
  MentionEntityItem,
  EntityContainer,
  extractSortedEntities,
  parseTextToSegments,
  toPureText,
  toMentionText,
  getBoundEntities,
} from '../../../lib/client-semantic-parser.js';

// 向下兼容导出通用类型与函数
export type { MentionEntityItem, EntityContainer };
export { extractSortedEntities, parseTextToSegments, toPureText, toMentionText, getBoundEntities };

// 兼容别名
export const normalizeTextWithMentions = toPureText;

export interface EntityMentionTextProps {
  text?: string;
  entities?: EntityContainer | null;
  className?: string;
  onClickEntity?: (entity: MentionEntityItem) => void;
}

/**
 * 单个实体高亮胶囊 (带 120ms 灵敏 Hover 定妆预览)
 */
export const EntityMentionPill: React.FC<{
  entity: MentionEntityItem;
  onClick?: (entity: MentionEntityItem) => void;
  displayText?: string;
  iconOverride?: string;
  pillClassName?: string;
  titleOverride?: string;
}> = ({ entity, onClick, displayText, iconOverride, pillClassName, titleOverride }) => {
  const [isHovered, setIsHovered] = useState(false);
  const showTimerRef = useRef<any>(null);
  const hideTimerRef = useRef<any>(null);

  const handleMouseEnter = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
    }
    showTimerRef.current = setTimeout(() => {
      setIsHovered(true);
    }, 120);
  };

  const handleMouseLeave = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    hideTimerRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 150);
  };

  const pillStyle =
    entity.type === 'character'
      ? 'bg-indigo-50/90 text-indigo-700 border-indigo-200/90 hover:bg-indigo-100 hover:border-indigo-300'
      : entity.type === 'location'
      ? 'bg-emerald-50/90 text-emerald-800 border-emerald-200/90 hover:bg-emerald-100 hover:border-emerald-300'
      : 'bg-amber-50/90 text-amber-800 border-amber-200/90 hover:bg-amber-100 hover:border-amber-300';

  const typeIcon =
    entity.type === 'character' ? '👤' : entity.type === 'location' ? '🎬' : '📦';

  return (
    <span
      className="relative inline-block align-baseline mx-0.5 my-0.5"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        onClick={() => onClick?.(entity)}
        className={
          pillClassName ||
          `inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md border text-[11px] font-semibold cursor-pointer select-text transition-all shadow-2xs ${pillStyle}`
        }
        title={titleOverride || `${entity.typeLabel} · 悬停查看定妆图`}
      >
        <span className="text-[10px] opacity-75">{iconOverride || typeIcon}</span>
        <span>{displayText || `@${entity.name}`}</span>
      </span>

      {isHovered && (entity.imageUrl || entity.spatialLayout) && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-2xl z-50 block animate-in fade-in zoom-in-95 duration-150 pointer-events-none select-none text-left"
        >
          {entity.imageUrl && (
            <div
              className={`w-full ${
                entity.type === 'location' ? 'aspect-video' : 'aspect-[2/1]'
              } rounded-xl overflow-hidden bg-slate-900/5 flex items-center justify-center border border-slate-100`}
            >
              <img
                src={entity.imageUrl}
                alt={entity.name}
                className="w-full h-full object-contain object-center"
              />
            </div>
          )}
          <div className="mt-1.5 px-0.5 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
              <span>{typeIcon}</span>
              <span>{entity.name}</span>
            </span>
            <span className={`text-[9px] px-1.5 py-0.2 rounded border font-mono ${pillStyle}`}>
              {entity.typeLabel}
            </span>
          </div>
          {entity.identity && (
            <div className="text-[10px] text-slate-500 truncate mt-0.5 px-0.5">
              {entity.identity}
            </div>
          )}
          {entity.spatialLayout && (
            <div className="mt-1 text-[9px] text-slate-600 bg-slate-50 p-1.5 rounded border border-slate-200 line-clamp-3 leading-tight font-mono">
              🧭 空间构造: {entity.spatialLayout}
            </div>
          )}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2.5 h-2.5 bg-white border-r border-b border-slate-200 transform rotate-45" />
        </span>
      )}
    </span>
  );
};

export const EntityMentionText: React.FC<EntityMentionTextProps> = ({
  text = '',
  entities,
  className = '',
  onClickEntity,
}) => {
  const segments = useMemo(() => {
    return parseTextToSegments(text, entities);
  }, [text, entities]);

  if (!text) return null;

  return (
    <span className={`inline leading-relaxed select-text ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.type === 'entity' && seg.entity) {
          return (
            <EntityMentionPill
              key={`entity_${seg.entity.id}_${idx}`}
              entity={seg.entity}
              onClick={onClickEntity}
            />
          );
        }
        return <React.Fragment key={`text_${idx}`}>{seg.content}</React.Fragment>;
      })}
    </span>
  );
};
