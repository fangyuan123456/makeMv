import React, { useEffect, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, GitFork, Maximize2 } from 'lucide-react';
import StoryGraphSvgDiagram, { type InteractiveStoryGraph } from './StoryGraphSvgDiagram';

interface StoryGraphModalProps {
  graph: InteractiveStoryGraph;
  isOpen: boolean;
  onClose: () => void;
}

export default function StoryGraphModal({ graph, isOpen, onClose }: StoryGraphModalProps) {
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const nodeCount = graph?.nodes?.length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 md:p-8 animate-in fade-in duration-200">
      {/* 弹窗主视窗 */}
      <div className="relative w-full h-full max-w-7xl bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* 顶部标题与控制栏 */}
        <div className="h-14 px-6 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <GitFork className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                网状互动故事拓扑全景图 (高清大图)
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800">
                  共 {nodeCount} 个剧情场景
                </span>
              </h2>
            </div>
          </div>

          {/* 缩放与退出工具组 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-800/80 rounded-xl p-1 border border-slate-700 text-xs">
              <button
                onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.15))}
                className="p-1.5 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer"
                title="缩小"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-[11px] font-mono text-slate-400 font-bold min-w-12 text-center">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.15))}
                className="p-1.5 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer"
                title="放大"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoomLevel(1)}
                className="p-1.5 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors ml-1 cursor-pointer"
                title="复位 100%"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer ml-2"
              title="关闭 (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 中间高清大图展示容器 (自适应可滚动) */}
        <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-slate-950">
          <div
            style={{
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'center center',
              transition: 'transform 0.15s ease-out',
            }}
            className="w-full max-w-6xl max-h-full flex items-center justify-center"
          >
            <StoryGraphSvgDiagram graph={graph} className="w-full h-auto shadow-2xl rounded-2xl overflow-hidden border border-slate-800" />
          </div>
        </div>

        {/* 底部退出快捷提示 */}
        <div className="h-9 px-6 bg-slate-900 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between shrink-0">
          <span>提示：支持通过顶部按键平滑无损缩放查看剧情分支细节</span>
          <span>按 <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono">ESC</kbd> 或点击右上角关闭</span>
        </div>
      </div>
    </div>
  );
}
