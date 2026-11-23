/**
 * client/src/components/studio/chat/ChatAttachmentStrip.tsx
 * 多模态对话图片/截图附件缩略图与页内高清放大预览组件 (SSOT)
 *
 * 核心能力：
 * 1. 同时覆盖「已发送消息附件 (message)」与「输入栏待发送截图 (pending)」两种形态；
 * 2. 点击任意缩略图直接在当前页通过 MediaLightboxModal 弹出放大预览，绝不跳转浏览器新标签页；
 * 3. 同组多张图片自动串联为 gallery，支持左右箭头与键盘 ← / → 切换、Esc 或点击遮罩关闭。
 */

import React, { useMemo, useState } from 'react';
import type { ChatImageAttachment } from '../../../lib/DirectorConversation.js';
import { MediaLightboxModal, type MediaLightboxItem } from '../stages/visual/MediaLightboxModal.js';

export interface ChatAttachmentStripProps {
  attachments: ChatImageAttachment[];
  variant: 'message' | 'pending';
  size?: 'sm' | 'md';
  onRemove?: (url: string) => void;
  className?: string;
}

export const ChatAttachmentStrip: React.FC<ChatAttachmentStripProps> = ({
  attachments,
  variant,
  size = 'md',
  onRemove,
  className = '',
}) => {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const gallery = useMemo<MediaLightboxItem[]>(
    () =>
      attachments.map((att, idx) => ({
        title: att.name || `截图附件 ${idx + 1}`,
        imageUrl: att.url,
      })),
    [attachments]
  );

  if (!attachments.length) return null;

  const isPending = variant === 'pending';
  const tileSizeClass = isPending
    ? size === 'sm'
      ? 'w-12 h-12'
      : 'w-14 h-14'
    : size === 'sm'
      ? 'w-16 h-16'
      : 'w-20 h-20';
  const gapClass = isPending && size === 'md' ? 'gap-2' : 'gap-1.5';

  const activeItem = previewIndex !== null ? gallery[previewIndex] : null;

  return (
    <>
      <div className={`flex flex-wrap ${gapClass} ${className}`.trim()}>
        {attachments.map((att, idx) =>
          isPending ? (
            <div
              key={`${att.url}-${idx}`}
              className={`relative group ${tileSizeClass} rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shadow-2xs`}
            >
              <button
                type="button"
                onClick={() => setPreviewIndex(idx)}
                className="block w-full h-full cursor-zoom-in focus:outline-none"
                title={att.name ? `${att.name}（点击放大预览）` : '点击放大预览'}
              >
                <img src={att.url} alt={att.name || '待发图片'} className="w-full h-full object-cover" />
                <span className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/25 transition flex items-center justify-center">
                  <span className="opacity-0 group-hover:opacity-100 transition text-white text-xs drop-shadow">
                    ⛶
                  </span>
                </span>
              </button>
              {onRemove && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(att.url);
                  }}
                  className={`absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/65 hover:bg-rose-600 text-white ${
                    size === 'sm' ? 'text-[9px]' : 'text-[10px]'
                  } flex items-center justify-center cursor-pointer z-10`}
                  title="移除图片"
                >
                  ✕
                </button>
              )}
            </div>
          ) : (
            <button
              key={`${att.url}-${idx}`}
              type="button"
              onClick={() => setPreviewIndex(idx)}
              className={`group relative block ${tileSizeClass} rounded-lg overflow-hidden border border-white/25 bg-black/10 hover:opacity-95 transition cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-indigo-400/70`}
              title={att.name ? `${att.name}（点击放大查看）` : '点击放大查看'}
            >
              <img src={att.url} alt={att.name || '图片附件'} className="w-full h-full object-cover" />
              <span className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 transition px-1.5 py-0.5 rounded bg-black/65 text-white text-[10px] font-medium">
                  ⛶
                </span>
              </span>
            </button>
          )
        )}
      </div>

      {activeItem && previewIndex !== null && (
        <MediaLightboxModal
          title={activeItem.title}
          imageUrl={activeItem.imageUrl}
          gallery={gallery}
          initialIndex={previewIndex}
          subtitle="对话参考图 / 截图原图预览"
          footerText={
            gallery.length > 1
              ? '按 Esc 或点击空白处关闭 · 支持 ← / → 切换'
              : '按 Esc 或点击空白处关闭'
          }
          downloadImageLabel="📥 下载原图"
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </>
  );
};
