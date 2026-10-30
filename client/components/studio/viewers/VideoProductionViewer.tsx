'use client';

import React from 'react';
import { Film, Play, RefreshCw, Volume2, Clock, CheckCircle2 } from 'lucide-react';
import { assetUrl } from '../../stages/utils';

interface VideoProductionViewerProps {
  videoArtifact?: any;
  onRegenerateClip?: (shotId: string) => void;
  isRunning?: boolean;
}

export default function VideoProductionViewer({
  videoArtifact,
  onRegenerateClip,
  isRunning,
}: VideoProductionViewerProps) {
  const clips = videoArtifact?.clips || [];

  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-gray-400">
        <Film className="w-12 h-12 mb-3 text-gray-300 animate-pulse" />
        <p className="text-sm font-medium">正在由【视频导演】逐镜头调用动态大模型渲染视频切片与配音...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-y-auto p-6 space-y-6">
      {/* 头部统计 */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
            <Film className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">节点动态视频切片库</h3>
            <p className="text-xs text-gray-500">已自动完成 Wanx/CogVideoX 动态渲染与 TTS 角色对白音轨合流</p>
          </div>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
          已完成切片：{clips.length} 个
        </span>
      </div>

      {/* 视频卡片流 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {clips.map((clip: any, idx: number) => {
          const videoUrl = clip.selected || clip.videoUrl;

          return (
            <div
              key={clip.shotId || idx}
              className="bg-white rounded-2xl border border-gray-200/90 overflow-hidden shadow-xs flex flex-col justify-between hover:border-indigo-300 transition-all"
            >
              <div className="aspect-video w-full bg-black relative flex items-center justify-center">
                {videoUrl ? (
                  <video
                    src={assetUrl(videoUrl)}
                    controls
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center p-4">
                    <Clock className="w-8 h-8 text-gray-500 mx-auto mb-2 animate-spin" />
                    <span className="text-xs text-gray-400">正在渲染动态视频...</span>
                  </div>
                )}
              </div>

              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-gray-900">{clip.shotId} 视频切片</span>
                  <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-bold">
                    {Math.round(clip.duration || 5)} 秒
                  </span>
                </div>

                {clip.prompt && (
                  <p className="text-[11px] text-gray-500 line-clamp-2">
                    动态提示词: {clip.prompt}
                  </p>
                )}

                {onRegenerateClip && (
                  <div className="pt-2 border-t border-gray-100 flex justify-end">
                    <button
                      onClick={() => onRegenerateClip(clip.shotId)}
                      className="px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" /> 重染此镜头
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
