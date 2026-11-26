/**
 * client/src/components/studio/canvas/TiptapMentionEditor.tsx
 * 基于 Tiptap (ProseMirror) 的极简纯粹视听实体编辑器 (Sleek Tiptap Mention Editor SSOT)
 *
 * 核心特性：
 * 1. 极致纯粹的文本编辑体验：无冗余底栏和顶部按钮，光标流转丝滑，行高平齐自然；
 * 2. 像 GitHub/Slack 一样的轻量微胶囊超链接（@实体名，无大图标，极浅背景，支持 Backspace 整块原子删除）；
 * 3. 敲击 @ 或 ＠ 原地秒级弹出智能联想菜单，采用 createPortal(document.body) 彻底脱离任何画布 transform/缩放/位移干扰；
 * 4. 键盘上下键 ↑ / ↓ 自由切换，Enter / Tab 回车一键补全，Esc 随时退出；
 * 5. 鼠标悬停（Hover）平滑防抖弹出高清定妆大图卡片；
 * 6. 双向数据流黄金保护准则：lastEmittedValueRef 阻断父组件反向刷屏，打字时绝对不丢光标与联想态。
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import {
  extractSortedEntities,
  toPureText,
  convertTextToTiptapHtml,
  EntityContainer,
  MentionEntityItem,
} from '../../../lib/client-semantic-parser.js';

export interface TiptapMentionEditorProps {
  value: string;
  onChange: (val: string) => void;
  entities?: EntityContainer | null;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  minRows?: number;
  isModified?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
}

export const TiptapMentionEditor: React.FC<TiptapMentionEditorProps> = ({
  value,
  onChange,
  entities,
  placeholder = '在 @场景 中，@角色 动作走位与 @道具 交互（输入 @ 快速选择定妆资产）...',
  className = '',
  autoFocus = false,
  minRows = 3,
  isModified = false,
  onBlur,
  onFocus,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sortedEntities = useMemo(() => extractSortedEntities(entities), [entities]);
  const lastEmittedValueRef = useRef<string>(value);

  // 1. 悬停定妆预览浮层状态 (防抖与平滑移入)
  const [hoveredEntity, setHoveredEntity] = useState<MentionEntityItem | null>(null);
  const [hoverPlacement, setHoverPlacement] = useState<{
    x: number;
    y: number;
    position: 'top' | 'bottom';
  } | null>(null);
  const hoverTimerRef = useRef<any>(null);
  const leaveTimerRef = useRef<any>(null);

  // 2. 光标处 @ 联想菜单状态
  const [suggestionState, setSuggestionState] = useState<{
    isOpen: boolean;
    items: MentionEntityItem[];
    selectedIndex: number;
    x: number;
    y: number;
    range: { from: number; to: number };
  } | null>(null);

  const suggestionStateRef = useRef(suggestionState);
  suggestionStateRef.current = suggestionState;

  const sortedEntitiesRef = useRef(sortedEntities);
  sortedEntitiesRef.current = sortedEntities;

  const editorRef = useRef<any>(null);

  // 清除防抖计时器
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  // 配置 Tiptap Mention 节点扩展（微胶囊超链接样式与原子删除特性）
  const mentionExtension = useMemo(() => {
    return Mention.extend({
      name: 'mention',
      addAttributes() {
        return {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-id'),
            renderHTML: (attributes) => ({
              'data-id': attributes.id || '',
            }),
          },
          label: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute('data-label') ||
              element.textContent?.replace(/^[👤🎬📦\s@]+/, '')?.trim() ||
              null,
            renderHTML: (attributes) => ({
              'data-label': attributes.label || '',
            }),
          },
          entityType: {
            default: 'character',
            parseHTML: (element) =>
              (element.getAttribute('data-entity-type') as any) || 'character',
            renderHTML: (attributes) => ({
              'data-entity-type': attributes.entityType || 'character',
            }),
          },
        };
      },
      renderText({ node }) {
        const raw = String(node?.attrs?.label ?? node?.attrs?.id ?? '').replace(/^[👤🎬📦\s@]+/, '');
        return raw ? `${raw}` : '';
      },
      renderHTML({ node, HTMLAttributes }) {
        const type = node?.attrs?.entityType || 'character';
        const colorClass =
          type === 'character'
            ? 'bg-indigo-50/80 text-indigo-700 border-indigo-200/60 hover:bg-indigo-100/80'
            : type === 'location'
            ? 'bg-emerald-50/80 text-emerald-800 border-emerald-200/60 hover:bg-emerald-100/80'
            : 'bg-amber-50/80 text-amber-800 border-amber-200/60 hover:bg-amber-100/80';
        const rawLabel = String(node?.attrs?.label ?? node?.attrs?.id ?? '').replace(/^[👤🎬📦\s@]+/, '');

        return [
          'span',
          {
            ...HTMLAttributes,
            'data-type': 'mention',
            'data-id': node?.attrs?.id || '',
            'data-label': rawLabel,
            'data-entity-type': type,
            class: `inline-flex items-center px-1 py-0.2 mx-0.5 rounded text-[11px] font-medium border ${colorClass} transition-colors align-baseline select-text cursor-pointer`,
          },
          `@${rawLabel || '实体'}`,
        ];
      },
    });
  }, []);

  // 插入选中实体并替换当前的 @query 文本
  const insertSelectedEntity = useCallback(
    (entity: MentionEntityItem, range?: { from: number; to: number }) => {
      if (!editorRef.current) return;
      const ed = editorRef.current;

      if (range) {
        ed.chain()
          .focus()
          .insertContentAt(range, [
            {
              type: 'mention',
              attrs: {
                id: entity.id,
                label: entity.name,
                entityType: entity.type,
              },
            },
            {
              type: 'text',
              text: ' ',
            },
          ])
          .run();
      } else {
        ed.chain()
          .focus()
          .insertContent([
            {
              type: 'mention',
              attrs: {
                id: entity.id,
                label: entity.name,
                entityType: entity.type,
              },
            },
            {
              type: 'text',
              text: ' ',
            },
          ])
          .run();
      }

      setSuggestionState(null);
    },
    []
  );

  // 实时检测光标处是否处于 @ 提及状态（全局文档坐标感知，彻底消除偏移误差）
  const updateMentionSuggestion = useCallback((ed: any) => {
    if (!ed) return;

    const { state } = ed;
    const { selection } = state;
    if (!selection.empty) {
      setSuggestionState(null);
      return;
    }

    const pos = selection.from;
    // 取光标前最多 30 个字符（将 inline 原子节点自动转换为空格，互不干扰）
    const searchStart = Math.max(0, pos - 30);
    const textBefore = state.doc.textBetween(searchStart, pos, ' ', ' ');

    // 匹配光标前紧挨着的 @ 或 ＠，后接 0-15 个非空白非@字符
    const match = /[@＠]([^\s@＠]{0,15})$/.exec(textBefore);
    if (!match) {
      setSuggestionState(null);
      return;
    }

    const query = match[1] || '';
    const matchLength = match[0].length;
    const from = pos - matchLength;
    const to = pos;

    const list = sortedEntitiesRef.current;
    const filtered = query
      ? list.filter((e) => e.name.toLowerCase().includes(query.toLowerCase())).slice(0, 10)
      : list.slice(0, 10);

    try {
      const coords = ed.view.coordsAtPos(pos);
      // 视口安全坐标计算（相对于屏幕 viewport）
      const x = Math.max(16, Math.min(window.innerWidth - 240, coords.left));
      const y = coords.bottom + 6;

      setSuggestionState((prev) => ({
        isOpen: true,
        items: filtered,
        selectedIndex: prev && prev.isOpen && prev.selectedIndex < filtered.length ? prev.selectedIndex : 0,
        x,
        y,
        range: { from, to },
      }));
    } catch {
      // 容错处理
    }
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: {
          HTMLAttributes: {
            class: 'm-0 p-0 leading-relaxed font-sans text-xs',
          },
        },
      }),
      mentionExtension,
    ],
    content: convertTextToTiptapHtml(value, sortedEntities),
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: `w-full text-xs leading-relaxed font-sans whitespace-pre-wrap break-words outline-hidden border-none p-0 m-0 cursor-text text-slate-800 ${className}`,
        style: 'outline: none; border: none; box-shadow: none; caret-color: #4f46e5; min-height: 48px;',
      },
      handleKeyDown(view, event) {
        const st = suggestionStateRef.current;
        if (!st || !st.isOpen) return false;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (st.items.length > 0) {
            setSuggestionState((prev) =>
              prev
                ? {
                    ...prev,
                    selectedIndex: (prev.selectedIndex + 1) % prev.items.length,
                  }
                : null
            );
          }
          return true;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (st.items.length > 0) {
            setSuggestionState((prev) =>
              prev
                ? {
                    ...prev,
                    selectedIndex: (prev.selectedIndex + prev.items.length - 1) % prev.items.length,
                  }
                : null
            );
          }
          return true;
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
          if (st.items.length > 0) {
            const selected = st.items[st.selectedIndex];
            if (selected) {
              event.preventDefault();
              insertSelectedEntity(selected, st.range);
              return true;
            }
          }
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          setSuggestionState(null);
          return true;
        }

        return false;
      },
    },
    onTransaction({ editor }) {
      updateMentionSuggestion(editor);
    },
    onSelectionUpdate({ editor }) {
      updateMentionSuggestion(editor);
    },
    onUpdate({ editor }) {
      let rawText = '';
      editor.state.doc.descendants((node) => {
        if (node.isText) {
          rawText += node.text;
        } else if (node.type.name === 'mention') {
          const l = String(node.attrs?.label ?? node.attrs?.id ?? '').replace(/^[👤🎬📦\s@]+/, '');
          if (l) rawText += `@${l}`;
        } else if (node.type.name === 'hardBreak') {
          rawText += '\n';
        }
      });

      lastEmittedValueRef.current = rawText;
      onChange(rawText);
      updateMentionSuggestion(editor);
    },
    onFocus({ editor }) {
      onFocus?.();
      updateMentionSuggestion(editor);
    },
    onBlur: () => {
      // 稍微延迟关闭联想菜单，以便鼠标点击能够先触发
      setTimeout(() => {
        setSuggestionState(null);
      }, 200);

      if (editor) {
        let rawText = '';
        editor.state.doc.descendants((node) => {
          if (node.isText) {
            rawText += node.text;
          } else if (node.type.name === 'mention') {
            const l = String(node.attrs?.label ?? node.attrs?.id ?? '').replace(/^[👤🎬📦\s@]+/, '');
            if (l) rawText += `${l}`;
          } else if (node.type.name === 'hardBreak') {
            rawText += '\n';
          }
        });
        const normalized = toPureText(rawText, entities);
        if (normalized !== rawText) {
          const newHtml = convertTextToTiptapHtml(normalized, sortedEntities);
          editor.commands.setContent(newHtml, { emitUpdate: false });
          lastEmittedValueRef.current = normalized;
          onChange(normalized);
        }
      }
      onBlur?.();
    },
  });

  editorRef.current = editor;

  // 外部 value 更新同步：采用黄金准则，自己打字发出的值坚决不反向 setContent
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedValueRef.current) return;

    lastEmittedValueRef.current = value;
    const cleanValue = toPureText(value, entities);

    if (!editor.isFocused) {
      editor.commands.setContent(convertTextToTiptapHtml(cleanValue, sortedEntities), { emitUpdate: false });
    }
  }, [value, sortedEntities, editor, entities]);

  // 平滑防抖的 Mention 悬浮大图触发与定位
  const handleContainerMouseOver = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-type="mention"]');
      if (target) {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }

        const rawAttr = target.getAttribute('data-label') || target.getAttribute('data-id') || target.textContent || '';
        const cleanName = rawAttr.replace(/^[👤🎬📦\s@]+/, '').trim();
        const id = target.getAttribute('data-id');
        const ent = sortedEntities.find(
          (item) => item.name === cleanName || item.name === rawAttr || item.id === id || item.id === cleanName
        );

        if (ent && ent.imageUrl) {
          const rect = target.getBoundingClientRect();
          const popoverHeight = 240;
          const showBelow = rect.top < popoverHeight;
          const centerX = Math.max(150, Math.min(window.innerWidth - 150, rect.left + rect.width / 2));
          const targetY = showBelow ? rect.bottom + 8 : rect.top - 8;

          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = setTimeout(() => {
            setHoverPlacement({
              x: centerX,
              y: targetY,
              position: showBelow ? 'bottom' : 'top',
            });
            setHoveredEntity(ent);
          }, 150);
          return;
        }
      }

      if (!leaveTimerRef.current) {
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
        leaveTimerRef.current = setTimeout(() => {
          setHoveredEntity(null);
          setHoverPlacement(null);
          leaveTimerRef.current = null;
        }, 200);
      }
    },
    [sortedEntities]
  );

  const handleContainerMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (!leaveTimerRef.current) {
      leaveTimerRef.current = setTimeout(() => {
        setHoveredEntity(null);
        setHoverPlacement(null);
        leaveTimerRef.current = null;
      }, 200);
    }
  }, []);

  const handlePopoverMouseEnter = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const handlePopoverMouseLeave = useCallback(() => {
    leaveTimerRef.current = setTimeout(() => {
      setHoveredEntity(null);
      setHoverPlacement(null);
      leaveTimerRef.current = null;
    }, 200);
  }, []);

  return (
    <div
      ref={containerRef}
      onMouseOver={handleContainerMouseOver}
      onMouseLeave={handleContainerMouseLeave}
      className={`relative w-full rounded-xl p-3 transition min-h-[64px] border ${
        isModified
          ? 'bg-amber-50/50 border-amber-300 ring-1 ring-amber-200'
          : 'bg-white border-slate-200/90 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/10 shadow-2xs hover:border-slate-300'
      }`}
    >
      {/* 纯粹富文本编辑区：输入与显示 100% 同体，光标穿透如同普通文本 */}
      <div
        className="w-full min-h-[48px] leading-relaxed cursor-text"
        onClick={() => editor?.commands.focus()}
      >
        <EditorContent editor={editor} />
      </div>

      {/* 光标原地弹出 @ 智能联想菜单 (使用 React Portal 直接挂载到 document.body，彻底消除 transform 和 overflow-hidden 裁切) */}
      {typeof document !== 'undefined' &&
        suggestionState &&
        suggestionState.isOpen &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: `${suggestionState.x}px`,
              top: `${suggestionState.y}px`,
              zIndex: 99999,
            }}
            className="w-56 p-1 bg-white/95 backdrop-blur-md rounded-xl border border-slate-200/90 shadow-2xl animate-in fade-in zoom-in-95 duration-100 select-none"
          >
            <div className="text-[10px] font-semibold text-slate-400 px-2 py-1 flex items-center justify-between border-b border-slate-100">
              <span>选择定妆资产</span>
              <span className="text-[9px] font-mono text-slate-400">↑↓ 选择 · ↵ 确认</span>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5 py-1">
              {suggestionState.items.length === 0 ? (
                <div className="text-[11px] text-slate-400 p-2 text-center">暂无匹配定妆实体</div>
              ) : (
                suggestionState.items.map((item, index) => {
                  const isSelected = index === suggestionState.selectedIndex;
                  const typeIcon = item.type === 'character' ? '👤' : item.type === 'location' ? '🎬' : '📦';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertSelectedEntity(item, suggestionState.range);
                      }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50/90 text-indigo-900 font-medium'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-5 h-5 rounded-md object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <span className="w-5 h-5 rounded-md bg-slate-100 text-[10px] flex items-center justify-center shrink-0">
                          {typeIcon}
                        </span>
                      )}
                      <span className="text-xs flex-1 truncate">{item.name}</span>
                      <span
                        className={`text-[9px] px-1 py-0.2 rounded border font-mono shrink-0 ${
                          item.type === 'character'
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            : item.type === 'location'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {item.typeLabel}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}

      {/* 悬浮定妆图大卡片浮层 (同样使用 React Portal 挂载到 document.body) */}
      {typeof document !== 'undefined' &&
        hoveredEntity &&
        hoverPlacement &&
        hoveredEntity.imageUrl &&
        createPortal(
          <div
            onMouseEnter={handlePopoverMouseEnter}
            onMouseLeave={handlePopoverMouseLeave}
            style={{
              position: 'fixed',
              left: `${hoverPlacement.x}px`,
              top: `${hoverPlacement.y}px`,
              transform: hoverPlacement.position === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
              zIndex: 99999,
            }}
            className="w-72 p-2 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-2xl select-none text-left animate-in fade-in zoom-in-95 duration-100"
          >
            <div
              className={`w-full ${
                hoveredEntity.type === 'location' ? 'aspect-video' : 'aspect-[2/1]'
              } rounded-xl overflow-hidden bg-slate-900/5 flex items-center justify-center border border-slate-100`}
            >
              <img
                src={hoveredEntity.imageUrl}
                alt={hoveredEntity.name}
                className="w-full h-full object-contain object-center"
              />
            </div>
            <div className="mt-1.5 px-0.5 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                <span>{hoveredEntity.type === 'character' ? '👤' : hoveredEntity.type === 'location' ? '🎬' : '📦'}</span>
                <span>{hoveredEntity.name}</span>
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.2 rounded border font-mono ${
                  hoveredEntity.type === 'character'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : hoveredEntity.type === 'location'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {hoveredEntity.typeLabel}
              </span>
            </div>
            {hoveredEntity.identity && (
              <div className="text-[10px] text-slate-500 truncate mt-0.5 px-0.5">
                {hoveredEntity.identity}
              </div>
            )}
            {/* 指示小三角 */}
            {hoverPlacement.position === 'top' ? (
              <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2.5 h-2.5 bg-white border-r border-b border-slate-200 transform rotate-45" />
            ) : (
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 -mb-1 w-2.5 h-2.5 bg-white border-l border-t border-slate-200 transform rotate-45" />
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
