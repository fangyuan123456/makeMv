/**
 * client/src/components/studio/canvas/PromptMentionEditor.tsx
 * 画布 @ 实体资产智能提示词编辑器 (Canvas @ Mention Prompt Editor)
 *
 * 核心功能：
 * 1. 键入 @ 自动呼出项目中已定妆的角色、场景与道具资产浮层；
 * 2. 键盘上下键选择 + Enter/Tab 补全，或鼠标单击直接插入；
 * 3. 提示词下方实时呈现当前镜头已引用的定妆资产胶囊 (Pills)；
 * 4. 提供 [+ @引用资产] 快捷呼出面板，实现无负担的显式资产绑定。
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

export interface MentionEntity {
  id: string;
  name: string;
  type: 'character' | 'location' | 'item';
  typeLabel: string;
  badgeColor: string;
  imageUrl?: string;
  identity?: string;
}

export interface PromptMentionEditorProps {
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  className?: string;
  entities?: {
    characters?: any[];
    locations?: any[];
    items?: any[];
  };
  onSelectEntity?: (entity: MentionEntity) => void;
}

export const PromptMentionEditor: React.FC<PromptMentionEditorProps> = ({
  value,
  onChange,
  placeholder = '输入画面提示词，输入 @ 快速绑定定妆资产...',
  disabled = false,
  rows = 6,
  className = '',
  entities,
  onSelectEntity,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 1. 归一化整理项目全部可用实体资产
  const availableEntities: MentionEntity[] = useMemo(() => {
    const list: MentionEntity[] = [];

    // 角色
    (entities?.characters || []).forEach((ch: any) => {
      if (ch.name) {
        list.push({
          id: ch.characterId || ch.id,
          name: ch.name.trim(),
          type: 'character',
          typeLabel: '角色',
          badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          imageUrl: ch.imageUrl || ch.referenceImageUrl,
          identity: ch.identity || ch.role,
        });
      }
    });

    // 场景
    (entities?.locations || []).forEach((loc: any) => {
      if (loc.name) {
        list.push({
          id: loc.locationId || loc.id,
          name: loc.name.trim(),
          type: 'location',
          typeLabel: '场景',
          badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          imageUrl: loc.imageUrl || loc.referenceImageUrl,
          identity: loc.atmosphere,
        });
      }
    });

    // 道具
    (entities?.items || []).forEach((it: any) => {
      if (it.name) {
        list.push({
          id: it.itemId || it.id,
          name: it.name.trim(),
          type: 'item',
          typeLabel: '道具',
          badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
          imageUrl: it.imageUrl || it.referenceImageUrl,
          identity: it.visualTrait,
        });
      }
    });

    return list;
  }, [entities]);

  // 2. 菜单状态
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [atIndex, setAtIndex] = useState<number>(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 3. 搜索过滤
  const filteredEntities = useMemo(() => {
    if (!query.trim()) return availableEntities;
    const q = query.toLowerCase().trim();
    return availableEntities.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.identity && e.identity.toLowerCase().includes(q))
    );
  }, [availableEntities, query]);

  // 4. 计算当前文本中已绑定的实体胶囊 (Pills)
  const referencedEntities = useMemo(() => {
    const text = value || '';
    return availableEntities.filter((e) =>
      text.includes(`@${e.name}`) || text.includes(`@ ${e.name}`)
    );
  }, [value, availableEntities]);

  // 5. 插入实体标签
  const handleInsert = useCallback(
    (entity: MentionEntity) => {
      const textarea = textareaRef.current;
      const text = value || '';
      const mentionText = `@${entity.name} `;

      let nextText = '';
      let nextCursor = 0;

      if (atIndex >= 0 && atIndex <= text.length) {
        // 从 @ 符号开始替换到当前光标
        const before = text.substring(0, atIndex);
        const after = text.substring(atIndex + 1 + query.length);
        nextText = before + mentionText + after;
        nextCursor = atIndex + mentionText.length;
      } else {
        // 直接在光标处追加或末尾插入
        const cursor = textarea ? textarea.selectionStart : text.length;
        const before = text.substring(0, cursor);
        const after = text.substring(cursor);
        nextText = before + (before.endsWith(' ') || before.length === 0 ? '' : ' ') + mentionText + after;
        nextCursor = before.length + mentionText.length;
      }

      onChange(nextText);
      onSelectEntity?.(entity);

      setIsOpen(false);
      setQuery('');
      setAtIndex(-1);

      // 重新对齐光标
      setTimeout(() => {
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(nextCursor, nextCursor);
        }
      }, 10);
    },
    [value, atIndex, query, onChange, onSelectEntity]
  );

  // 6. 侦听键盘与打字输入 (兼容中文拼音输入法合成态)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 若正在处于输入法拼音选字合成阶段，不拦截回车
    if ((e.nativeEvent as any)?.isComposing) return;
    if (!isOpen || filteredEntities.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredEntities.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(
        (prev) => (prev - 1 + filteredEntities.length) % filteredEntities.length
      );
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const target = filteredEntities[selectedIndex];
      if (target) {
        handleInsert(target);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const handleInputCheck = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    const text = target.value;
    const cursor = target.selectionStart;

    // 寻找光标前最近的一个 @ 或全角 ＠ 符号
    const textBeforeCursor = text.substring(0, cursor);
    const lastAtIndex = Math.max(
      textBeforeCursor.lastIndexOf('@'),
      textBeforeCursor.lastIndexOf('＠')
    );

    if (lastAtIndex >= 0) {
      const queryPart = textBeforeCursor.substring(lastAtIndex + 1);
      // 若光标与 @ 之间无换行，且长度不超过 12 个字，则激活菜单
      if (!queryPart.includes('\n') && queryPart.length <= 12) {
        setAtIndex(lastAtIndex);
        setQuery(queryPart);
        setIsOpen(true);
        setSelectedIndex(0);
        return;
      }
    }

    if (isOpen) {
      setIsOpen(false);
    }
  };

  // 点击外部收起菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-full space-y-2">
      {/* 文本输入框 */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            handleInputCheck(e);
          }}
          onSelect={handleInputCheck}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={rows}
          className={`w-full rounded-xl border bg-slate-50/70 focus:bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 outline-hidden resize-y disabled:opacity-60 transition shadow-2xs border-slate-200/90 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 ${className}`}
          placeholder={placeholder}
        />

        {/* 快捷插入实体按钮 (右下角快捷胶囊) */}
        <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setIsOpen(true);
              setQuery('');
              setAtIndex(-1);
              textareaRef.current?.focus();
            }}
            disabled={disabled || availableEntities.length === 0}
            className="px-2 py-1 rounded-lg bg-white/90 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 text-indigo-600 text-[11px] font-semibold flex items-center gap-1 shadow-2xs transition cursor-pointer disabled:opacity-40"
            title="快捷呼出定妆资产引用列表"
          >
            <span>@</span>
            <span>引用定妆资产</span>
          </button>
        </div>

        {/* @ 智能实体联想悬浮层 */}
        {isOpen && (
          <div
            ref={menuRef}
            className="absolute bottom-full left-0 mb-1 z-50 w-72 max-h-64 bg-white/95 backdrop-blur-md border border-indigo-200 rounded-2xl shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="px-3 py-2 bg-indigo-50/70 border-b border-indigo-100 flex items-center justify-between text-[11px] text-indigo-900 font-semibold select-none">
              <span className="flex items-center gap-1">
                <span>🏷️</span>
                <span>选择定妆资产 (↑↓回车)</span>
              </span>
              <span className="text-[10px] text-indigo-500 font-normal">
                {filteredEntities.length} 个资产
              </span>
            </div>

            <div className="overflow-y-auto max-h-52 p-1.5 space-y-1">
              {filteredEntities.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  未匹配到相关定妆资产
                </div>
              ) : (
                filteredEntities.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleInsert(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 cursor-pointer transition select-none ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'hover:bg-slate-100/80 text-slate-700'
                      }`}
                    >
                      {/* 实体缩略图 */}
                      <div
                        className={`w-7 h-7 rounded-lg overflow-hidden shrink-0 border flex items-center justify-center bg-slate-900 text-xs ${
                          isSelected ? 'border-white/40' : 'border-slate-200'
                        }`}
                      >
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span>
                            {item.type === 'character'
                              ? '👤'
                              : item.type === 'location'
                              ? '🏞️'
                              : '📻'}
                          </span>
                        )}
                      </div>

                      {/* 实体名称与描述 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs truncate">
                            {item.name}
                          </span>
                          <span
                            className={`text-[9px] px-1 py-0.2 rounded-md font-medium border ${
                              isSelected
                                ? 'bg-white/20 text-white border-white/30'
                                : item.badgeColor
                            }`}
                          >
                            {item.typeLabel}
                          </span>
                        </div>
                        {item.identity && (
                          <div
                            className={`text-[10px] truncate ${
                              isSelected ? 'text-indigo-100' : 'text-slate-400'
                            }`}
                          >
                            {item.identity}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部已绑定的定妆资产胶囊栏 (Asset Pills) */}
      {referencedEntities.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5 pt-0.5">
          <span className="text-[10px] font-semibold text-slate-400 select-none">
            已生效定妆:
          </span>
          {referencedEntities.map((entity) => (
            <span
              key={entity.id}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-xs font-medium shadow-2xs transition ${entity.badgeColor}`}
              title={`已绑定 ${entity.name} 定妆图，生图引擎将精确对齐脸部骨相与材质`}
            >
              {entity.imageUrl ? (
                <img
                  src={entity.imageUrl}
                  alt={entity.name}
                  className="w-3.5 h-3.5 rounded-full object-cover shrink-0 ring-1 ring-black/10"
                />
              ) : (
                <span className="text-[10px]">
                  {entity.type === 'character'
                    ? '👤'
                    : entity.type === 'location'
                    ? '🏞️'
                    : '📻'}
                </span>
              )}
              <span className="font-bold">@{entity.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
