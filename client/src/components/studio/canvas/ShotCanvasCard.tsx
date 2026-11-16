/**
 * client/src/components/studio/canvas/ShotCanvasCard.tsx
 * 视听画布分镜节点卡片组件 (Shot Canvas Card SSOT)
 *
 * 核心特性：
 * 1. 视听预览窗：支持首帧图片与成品视频预览（悬浮自动播放）；
 * 2. 多候选方案切换器 (Candidate Selector)：支持同分镜多方案并存与一键采纳；
 * 3. 局部快捷生成：单镜头直接派发独立 Task，完全不影响全剧其他节点。
 */

import React, { useState, useRef } from 'react';
import type { CanvasShotNode } from '../../../types/index.js';

interface ShotCanvasCardProps {
  node: CanvasShotNode;
  isSelected?: boolean;
  onSelect?: () => void;
  onOpenDrillDown?: (node: CanvasShotNode) => void;
  onRenderVideo: (node: CanvasShotNode, customPrompt?: string) => void;
  onSelectCandidate: (nodeId: string, taskId: string) => void;
  isBusy?: boolean;
}

export const ShotCanvasCard: React.FC<ShotCanvasCardProps> = ({
  node,
  isSelected,
  onSelect,
  onOpenDrillDown,
  onRenderVideo,
  onSelectCandidate,
  isBusy,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPromptEdit, setShowPromptEdit] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(node.prompt || '');
  const videoRef = useRef<HTMLVideoElement>(null);

  const hasVideo = Boolean(node.videoUrl);
  const hasKeyframe = Boolean(node.keyframeUrl);
  const candidates = node.candidateTaskIds || [];

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (hasVideo && videoRef.current) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (hasVideo && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  return (
    <div
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpenDrillDown?.(node);
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        width: node.size?.w || 320,
      }}
      className={`absolute select-none bg-white rounded-2xl border transition-shadow duration-200 cursor-move shadow-md hover:shadow-xl ${
        isSelected
          ? 'border-indigo-500 ring-2 ring-indigo-500/20 z-30'
          : 'border-slate-200/90 z-10 hover:border-slate-300'
      }`}
    >
      {/* 左右连接桩端点 (Port Anchors 用于 SVG 连线对齐) */}
      <div
        id={`port-in-${node.id}`}
        className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-300 hover:border-indigo-600 transition shadow-xs z-20 flex items-center justify-center pointer-events-auto"
        title="输入端点 (前序因果)"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
      </div>

      <div
        id={`port-out-${node.id}`}
        className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-300 hover:border-indigo-600 transition shadow-xs z-20 flex items-center justify-center pointer-events-auto"
        title="输出端点 (后续分支)"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
      </div>

      {/* 卡片顶栏 */}
      <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 rounded-t-2xl">
        <div className="flex items-center space-x-2 truncate">
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100/80">
            {node.clipId}
          </span>
          <span className="text-xs font-bold text-slate-900 truncate" title={node.title}>
            {node.title}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono text-slate-400">⏱️ {node.durationSec || 4.0}s</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDrillDown?.(node);
            }}
            className="px-1.5 py-0.5 rounded-md text-[10px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition border border-indigo-100/80 flex items-center gap-0.5"
            title="深入递进演播舱"
          >
            <span>🔍</span>
            <span>演播舱</span>
          </button>
        </div>
      </div>

      {/* 中部：媒体视听视窗 */}
      <div className="relative w-full h-44 bg-slate-900 overflow-hidden flex items-center justify-center group">
        {hasVideo ? (
          <video
            ref={videoRef}
            src={node.videoUrl}
            poster={node.keyframeUrl}
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : hasKeyframe ? (
          <img
            src={node.keyframeUrl}
            alt={node.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center justify-center space-y-1.5 text-slate-500">
            <span className="text-2xl">🎬</span>
            <span className="text-[11px] font-medium">待生成视听镜头</span>
          </div>
        )}

        {/* 悬浮播放状态标签 */}
        {hasVideo && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-[10px] font-mono text-white flex items-center gap-1">
            <span>{isPlaying ? '▶' : '⏸'}</span>
            <span>MP4</span>
          </div>
        )}

        {/* 快捷悬浮遮罩操作 */}
        <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRenderVideo(node, customPrompt);
            }}
            disabled={isBusy}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-md transition active:scale-95 flex items-center gap-1 disabled:opacity-50"
          >
            <span>🎬</span>
            <span>{hasVideo ? '重制本镜头' : '渲染视频'}</span>
          </button>
        </div>
      </div>

      {/* 提示词说明 */}
      <div className="p-3 bg-white space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="font-semibold text-slate-700">镜头提示词</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowPromptEdit(!showPromptEdit);
            }}
            className="text-indigo-600 hover:underline text-[10px]"
          >
            {showPromptEdit ? '收起' : '编辑'}
          </button>
        </div>

        {showPromptEdit ? (
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            rows={2}
            className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
            placeholder="自定义本镜头视频生成提示词..."
          />
        ) : (
          <p
            className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed"
            title={node.prompt}
          >
            {node.prompt || '暂无详细提示词，将基于分镜自动生成'}
          </p>
        )}

        {/* 核心亮点：多候选方案胶囊切换器 (Candidate Selector) */}
        {candidates.length > 1 && (
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1 overflow-x-auto no-scrollbar">
            <span className="text-[10px] text-slate-400 font-medium shrink-0">备选方案:</span>
            <div className="flex items-center space-x-1 shrink-0">
              {candidates.map((tid, idx) => {
                const isActive = node.activeTaskId === tid;
                return (
                  <button
                    key={tid}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCandidate(node.id, tid);
                    }}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono transition ${
                      isActive
                        ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    title={`采用任务 [${tid}] 的生成视频`}
                  >
                    方案 {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
