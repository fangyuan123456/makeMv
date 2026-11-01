'use client';

import React, { useState } from 'react';
import {
  Gamepad2,
  Download,
  MonitorPlay,
  Sparkles,
  Video,
} from 'lucide-react';
import FMVInteractivePlayer from '../stages/FMVInteractivePlayer';
import { assetUrl } from '../stages/utils';

interface GameDisplayPanelProps {
  artifacts: Record<string, any>;
  sessionId: string | null;
  isRunning: boolean;
}

export default function GameDisplayPanel({
  artifacts,
  sessionId,
  isRunning,
}: GameDisplayPanelProps) {
  const [selectedClipIdx, setSelectedClipIdx] = useState(0);

  const packagerArtifact = artifacts['fmv_packaging'];
  const videoArtifact = artifacts['video_production'];
  const referenceArtifact = artifacts['keyframe_reference'];

  const manifest = packagerArtifact?.fmvManifest;
  const clips = videoArtifact?.renderedClips || videoArtifact?.clips || [];
  const keyframes = referenceArtifact?.shots || referenceArtifact?.keyframes || [];

  const downloadManifest = () => {
    if (!manifest) return;
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(manifest, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'game_manifest.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="flex flex-col h-full bg-slate-100/90 text-slate-800 relative overflow-hidden select-none">
      {/* 视窗顶部控制条 */}
      <div className="h-12 bg-white/95 border-b border-slate-200/90 px-5 flex items-center justify-between shrink-0 z-10 backdrop-blur-md shadow-2xs">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-xs shadow-emerald-500/30" />
          <h2 className="text-xs font-bold tracking-wide text-slate-800 flex items-center gap-1.5">
            <MonitorPlay className="w-3.5 h-3.5 text-indigo-600" />
            互动影游实时视窗
          </h2>
          {manifest && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              交互运行时就绪
            </span>
          )}
          {!manifest && clips.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
              视频切片已就绪 ({clips.length}个)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {manifest && (
            <button
              onClick={downloadManifest}
              className="flex items-center gap-1 px-3 py-1 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-bold transition-all cursor-pointer border border-slate-200 shadow-2xs"
              title="导出 game_manifest.json"
            >
              <Download className="w-3 h-3 text-slate-500" />
              <span>导出 Manifest</span>
            </button>
          )}
        </div>
      </div>

      {/* 游戏核心荧幕播放区 */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-hidden relative">
        {/* 背景柔和光晕 */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.06),transparent_70%)] pointer-events-none" />

        {manifest && sessionId ? (
          /* 1. 影游全量交互运行时 */
          <div className="w-full h-full max-w-5xl rounded-2xl overflow-hidden border border-slate-300 shadow-2xl bg-black relative z-10 flex flex-col">
            <FMVInteractivePlayer manifest={manifest} sessionId={sessionId} />
          </div>
        ) : clips.length > 0 ? (
          /* 2. 视频切片预览 */
          <div className="w-full h-full max-w-5xl flex flex-col items-center justify-center space-y-4 relative z-10">
            <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black border border-slate-300 shadow-2xl relative">
              <video
                key={clips[selectedClipIdx]?.videoUrl || clips[selectedClipIdx]?.video_path}
                src={assetUrl(clips[selectedClipIdx]?.videoUrl || clips[selectedClipIdx]?.video_path)}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md text-[11px] text-white font-mono">
                节点切片: {clips[selectedClipIdx]?.sceneId || `Clip #${selectedClipIdx + 1}`}
              </div>
            </div>

            {clips.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto max-w-full p-2 bg-white rounded-xl border border-slate-200 shadow-xs">
                {clips.map((c: any, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedClipIdx(idx)}
                    className={`px-3 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer whitespace-nowrap ${
                      selectedClipIdx === idx
                        ? 'bg-indigo-600 text-white font-bold shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    节点 {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : keyframes.length > 0 ? (
          /* 3. 关键帧视觉监视器 */
          <div className="w-full h-full max-w-4xl flex flex-col items-center justify-center space-y-3 relative z-10">
            <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black border border-slate-300 shadow-2xl relative flex items-center justify-center">
              <img
                src={assetUrl(keyframes[0]?.imageUrl || keyframes[0]?.image_url || keyframes[0]?.path)}
                alt="Keyframe Preview"
                className="w-full h-full object-contain"
              />
              <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-md text-xs text-white flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>分镜关键帧已同步 · 等待生成动态视频...</span>
              </div>
            </div>
          </div>
        ) : (
          /* 4. 干净整洁明亮的待机状态展示屏 */
          <div className="w-full max-w-2xl aspect-video rounded-3xl border border-slate-200 bg-white/95 backdrop-blur-sm shadow-xl shadow-slate-200/80 flex flex-col items-center justify-center p-8 text-center relative z-10">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-150 flex items-center justify-center text-indigo-600 mb-4 shadow-sm shadow-indigo-100">
              <Gamepad2 className="w-8 h-8 animate-pulse" />
            </div>
            <h3 className="text-base font-bold text-slate-800 tracking-tight">
              {isRunning ? 'AI 导演正在为您推演制作中...' : '等待影游成片推流'}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mt-2 leading-relaxed">
              请在左侧对话区与 AI 畅聊你的故事灵感。生成的分镜、角色定妆、分支剧情与视频成片将在此处实时上映与试玩。
            </p>

            <div className="mt-6 flex items-center gap-3 text-[11px] text-slate-400 font-mono">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                16:9 影院级视窗
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                无缝决策微循环
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-600" />
                即时触控互动
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
