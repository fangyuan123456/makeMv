/**
 * client/src/components/studio/stages/visual/MediaLightboxModal.tsx
 * 高清大图与全屏视听播放器放大弹窗 (Media Lightbox Modal SSOT)
 */

import React, { useEffect } from 'react';

export interface MediaLightboxModalProps {
  title: string;
  imageUrl?: string;
  videoUrl?: string;
  onClose: () => void;
}

export const MediaLightboxModal: React.FC<MediaLightboxModalProps> = ({
  title,
  imageUrl,
  videoUrl,
  onClose,
}) => {
  // 监听 ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
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
            <span className="text-xl">🎬</span>
            <div>
              <h3 className="text-sm font-bold text-slate-100 tracking-wide">{title}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {videoUrl ? '高保真视听切片播放' : '4K 关键帧超清原图预览'}
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
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              autoPlay
              loop
              playsInline
              className="w-full h-full object-contain"
            />
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-500 space-y-2">
              <span className="text-5xl opacity-40">🎬</span>
              <span className="text-sm font-medium">尚未渲染视听画面</span>
            </div>
          )}
        </div>

        {/* 底部操作与规格提示栏 */}
        <div className="p-3 px-6 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>影视切片规格：16:9 · 854×480 · 24fps</span>
          </div>
          <div className="flex items-center space-x-3">
            {imageUrl && (
              <a
                href={imageUrl}
                target="_blank"
                rel="noreferrer"
                download
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition"
              >
                📥 下载首帧原图
              </a>
            )}
            {videoUrl && (
              <a
                href={videoUrl}
                target="_blank"
                rel="noreferrer"
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
};
