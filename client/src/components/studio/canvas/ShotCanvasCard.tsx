/**
 * client/src/components/studio/canvas/ShotCanvasCard.tsx
 * 视听画布分镜节点卡片组件 (Shot Canvas Card SSOT)
 *
 * 核心特性：
 * 1. 视听预览窗：支持首帧图片与成品视频预览（悬浮自动播放）；
 * 2. 节点只负责展示首帧、悬停预览视频与镜头台本；生成操作在下一级处理。
 */

import React, { useState, useRef } from 'react';
import type { CanvasShotNode } from '../../../types/index.js';

interface ShotCanvasCardProps {
  node: CanvasShotNode;
  isSelected?: boolean;
  isExtractingPrompt?: boolean;
  onSelect?: () => void;
  onOpenDrillDown?: (node: CanvasShotNode) => void;
}

export const ShotCanvasCard: React.FC<ShotCanvasCardProps> = ({
  node,
  isSelected,
  isExtractingPrompt,
  onSelect,
  onOpenDrillDown,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const hasVideo = Boolean(node.videoUrl);
  const hasKeyframe = Boolean(node.keyframeUrl);
  const isUnlocked = node.isUnlocked !== false;

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
      onClick={() => isUnlocked && onSelect?.()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (isUnlocked) onOpenDrillDown?.(node);
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        width: node.size?.w || 260,
      }}
      className={`absolute select-none bg-white rounded-2xl border transition-all duration-200 cursor-move shadow-[0_4px_20px_-4px_rgba(15,23,42,0.08)] hover:shadow-[0_10px_30px_-6px_rgba(15,23,42,0.14)] overflow-hidden ${
        isSelected
          ? 'border-indigo-500 ring-4 ring-indigo-500/15 z-30'
          : isUnlocked
            ? 'border-slate-200/90 z-10 hover:border-indigo-300'
            : 'border-slate-200/60 z-10 opacity-60 bg-slate-50'
      }`}
    >
      {/* 左右连接桩端点 (Port Anchors 对齐 16:9 视听窗口正中) */}
      <div
        id={`port-in-${node.id}`}
        className="absolute -left-2 top-[116px] -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-300 hover:border-indigo-600 transition shadow-xs z-20 flex items-center justify-center pointer-events-auto"
        title="输入端点 (前序因果)"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
      </div>

      <div
        id={`port-out-${node.id}`}
        className="absolute -right-2 top-[116px] -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-300 hover:border-indigo-600 transition shadow-xs z-20 flex items-center justify-center pointer-events-auto"
        title="输出端点 (后续分支)"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
      </div>

      {/* 顶部标题与时长状态条 (明朗通透排版) */}
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-100">
        <span className="text-xs font-bold text-slate-900 truncate" title={node.title}>
          {node.title}
        </span>
        <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100/90 px-1.5 py-0.5 rounded-md border border-slate-200/60 shrink-0 ml-1.5">
          {node.durationSec || 4.0}s
        </span>
      </div>

      {/* 中部：媒体视听画廊视窗 (16:9 画幅比例) */}
      <div className="relative w-full h-40 bg-slate-100/70 overflow-hidden flex items-center justify-center group">
        {/* 左上角版本数指示 */}
        {((node.firstFrameVersions && node.firstFrameVersions.length > 1) || (node.videoVersions && node.videoVersions.length > 1)) && (
          <div
            className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded-lg bg-black/65 backdrop-blur-xs text-[9px] font-mono font-semibold text-white border border-white/20 shadow-2xs"
            title="当前镜头拥有多版本可选（双击卡片进入版本库选择）"
          >
            📚 {Math.max(node.firstFrameVersions?.length || 0, node.videoVersions?.length || 0)} 版
          </div>
        )}
        {/* 时空连贯继承角标 */}
        {node.continuityMode === 'linked' && (
          <div
            className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded-lg bg-emerald-600/95 backdrop-blur-xs text-[9px] font-bold text-white shadow-2xs border border-emerald-400/30"
            title="当前镜头承接前序尾帧光影与动作"
          >
            🔗 继承尾帧
          </div>
        )}
        {hasKeyframe ? (
          <img
            src={node.keyframeUrl}
            alt={node.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : hasVideo ? (
          <video
            ref={videoRef}
            src={node.videoUrl}
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : isExtractingPrompt ? (
          <div className="flex flex-col items-center justify-center space-y-1.5 text-indigo-600 p-3 text-center animate-pulse">
            <span className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mb-1" />
            <span className="text-[11px] font-bold text-indigo-700">推演分镜词中...</span>
            <span className="text-[9px] text-slate-400">双击进入查看详情</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-1.5 text-slate-400 p-3 text-center">
            <span className="text-2xl opacity-70">🎬</span>
            <span className="text-[11px] font-semibold text-slate-500">待生成视听镜头</span>
            <span className="text-[9px] text-slate-400">双击卡片下钻制作</span>
          </div>
        )}

        {/* 悬浮播放状态标签 */}
        {hasVideo && hasKeyframe && (
          <video
            ref={videoRef}
            src={node.videoUrl}
            loop
            muted
            playsInline
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-150 ${isPlaying ? 'opacity-100' : 'opacity-0'}`}
          />
        )}

        {(node.staleKeyframeReason || node.staleVideoReason) && (
          <div
            className="absolute bottom-2 left-2 z-10 px-1.5 py-0.5 rounded bg-amber-500/90 backdrop-blur-xs text-[10px] font-semibold text-white shadow-xs"
            title={node.staleKeyframeReason || node.staleVideoReason}
          >
            ⚠ 上游已变更
          </div>
        )}
        {(node.firstFrameUpscale || node.lastFrameUpscale) && (() => {
          const firstUp = node.firstFrameUpscale;
          const lastUp = node.lastFrameUpscale;
          const label =
            firstUp && lastUp
              ? `✨ 首/末 HD ${firstUp.multiplier}×`
              : firstUp
              ? `✨ HD ${firstUp.multiplier}×`
              : `✨ 末帧 HD ${lastUp!.multiplier}×`;
          const tooltip = [
            firstUp ? `首帧已通过 SeedVR2 完成 ${firstUp.multiplier}× 高清超分` : '',
            lastUp ? `末帧已通过 SeedVR2 完成 ${lastUp.multiplier}× 高清超分` : '',
          ]
            .filter(Boolean)
            .join('；');
          return (
            <div
              className="absolute bottom-2 right-2 z-10 px-1.5 py-0.5 rounded-md bg-emerald-600/95 backdrop-blur-xs text-[10px] font-mono font-bold text-white shadow-xs border border-emerald-300/40"
              title={tooltip}
            >
              {label}
            </div>
          );
        })()}
        {hasVideo && isHovered && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-[10px] font-mono text-white flex items-center gap-1">
            <span>{isPlaying ? '▶' : '⏸'}</span>
            <span>预览</span>
          </div>
        )}
        {!isUnlocked && (
          <div className="absolute inset-0 z-20 bg-slate-900/40 backdrop-blur-2xs flex items-center justify-center">
            <div className="px-3 py-1.5 rounded-full bg-white/95 border border-slate-200 text-[11px] font-semibold text-slate-700 shadow-md flex items-center gap-1.5">
              <span>🔒</span>
              <span>等待前一镜头完成</span>
            </div>
          </div>
        )}
      </div>

      {/* 底部：动作切片正文与视听机位/天气标签外显 */}
      <div className="px-3 py-2 bg-slate-50/90 border-t border-slate-100 flex flex-col gap-1.5">
        {/* 视听标签栏：机位/景别、天气光影约束标签 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {node.cameraDirective?.label && (
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/60 shrink-0"
              title={`机位景别: ${node.cameraDirective.instruction}`}
            >
              🎥 {node.cameraDirective.label}
            </span>
          )}
          {node.weatherDirective?.label && (
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200/60 shrink-0"
              title={`天气光影: ${node.weatherDirective.instruction}`}
            >
              ⛅ {node.weatherDirective.label}
            </span>
          )}
        </div>

        {/* 核心动作切片正文 (sliceSummary / sceneSubject) */}
        {(node.sliceSummary || node.sceneSubject) ? (
          <p
            className="text-[11px] leading-relaxed text-slate-600 line-clamp-2 select-text hover:text-slate-900 transition-colors"
            title={node.sliceSummary || node.sceneSubject}
          >
            {node.sliceSummary || node.sceneSubject}
          </p>
        ) : (
          <p className="text-[10px] text-slate-400 italic">待切片演绎动作细节</p>
        )}
      </div>

    </div>
  );
};
