/**
 * client/src/components/studio/stages/visual/MediaLightboxModal.tsx
 * 高清大图与全屏视听播放器放大弹窗 (Media Lightbox Modal SSOT)
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MediaLightboxItem {
  title: string;
  imageUrl?: string;
  videoUrl?: string;
  badge?: string;
  subtitle?: string;
}

export interface MediaLightboxModalProps {
  title: string;
  imageUrl?: string;
  videoUrl?: string;
  badge?: string;
  gallery?: MediaLightboxItem[];
  initialIndex?: number;
  subtitle?: string;
  footerText?: string;
  downloadImageLabel?: string;
  onClose: () => void;
}

export const MediaLightboxModal: React.FC<MediaLightboxModalProps> = ({
  title,
  imageUrl,
  videoUrl,
  badge,
  gallery,
  initialIndex,
  subtitle,
  footerText,
  downloadImageLabel,
  onClose,
}) => {
  const items = gallery?.length ? gallery : [{ title, imageUrl, videoUrl, badge, subtitle }];
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (typeof initialIndex === 'number' && initialIndex >= 0 && initialIndex < items.length) {
      return initialIndex;
    }
    const index = items.findIndex((item) => item.imageUrl === imageUrl && item.videoUrl === videoUrl);
    return index < 0 ? 0 : index;
  });
  const current = items[currentIndex] || items[0];
  const hasNavigation = items.length > 1;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (items.length < 2) return;
      if (e.key === 'ArrowLeft') setCurrentIndex((index) => (index - 1 + items.length) % items.length);
      if (e.key === 'ArrowRight') setCurrentIndex((index) => (index + 1) % items.length);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, items.length]);

  const modalContent = (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-slate-900 border border-slate-700/80 rounded-3xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200"
      >
        {/* 顶部标题栏与关闭按钮 */}
        <div className="p-4 px-6 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-xl">{current.videoUrl ? '🎬' : '🖼️'}</span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-100 tracking-wide">{current.title}</h3>
                {(current.badge || (!gallery?.length && badge)) && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/90 text-white text-[10px] font-mono font-bold shadow-2xs">
                    {current.badge || badge}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {current.subtitle ??
                  subtitle ??
                  (current.videoUrl
                    ? '高保真视听切片播放'
                    : current.badge || (!gallery?.length && badge)
                    ? `SeedVR2 高清超分原图预览（${current.badge || badge}）`
                    : '原图预览（未超分）')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition cursor-pointer text-lg font-bold"
            title="关闭 (Esc)"
          >
            ✕
          </button>
        </div>

        {/* 核心大屏视听媒体区 (16:9) */}
        <div className="flex-1 bg-black flex items-center justify-center relative aspect-video max-h-[75vh] overflow-hidden">
          {current.videoUrl ? (
            <video
              key={current.videoUrl}
              src={current.videoUrl}
              controls
              autoPlay
              loop
              playsInline
              className="w-full h-full object-contain"
            />
          ) : current.imageUrl ? (
            <img
              src={current.imageUrl}
              alt={current.title}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-500 space-y-2">
              <span className="text-5xl opacity-40">🎬</span>
              <span className="text-sm font-medium">尚未渲染视听画面</span>
            </div>
          )}
          {hasNavigation && (
            <>
              <button
                type="button"
                onClick={() => setCurrentIndex((index) => (index - 1 + items.length) % items.length)}
                className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-slate-950/75 hover:bg-slate-800 text-white text-3xl flex items-center justify-center transition cursor-pointer"
                aria-label="上一张"
                title="上一张 (←)"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setCurrentIndex((index) => (index + 1) % items.length)}
                className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-slate-950/75 hover:bg-slate-800 text-white text-3xl flex items-center justify-center transition cursor-pointer"
                aria-label="下一张"
                title="下一张 (→)"
              >
                ›
              </button>
            </>
          )}
        </div>

        {/* 底部操作与规格提示栏 */}
        <div className="p-3 px-6 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            {hasNavigation && <span className="font-mono text-slate-200 shrink-0">{currentIndex + 1} / {items.length}</span>}
            <span className="hidden sm:inline truncate">
              {footerText ?? '影视切片规格：16:9 · 854×480 · 24fps'}
            </span>
          </div>
          <div className="flex items-center space-x-3">
            {current.imageUrl && (
              <a
                href={current.imageUrl}
                download
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition"
              >
                {downloadImageLabel ?? '📥 下载首帧原图'}
              </a>
            )}
            {current.videoUrl && (
              <a
                href={current.videoUrl}
                download
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition"
              >
                📥 下载视频文件
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
