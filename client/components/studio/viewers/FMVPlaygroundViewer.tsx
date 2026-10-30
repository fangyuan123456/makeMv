'use client';

import React, { useState } from 'react';
import { Gamepad2, Film, Download, CheckCircle2, Sparkles, Layers } from 'lucide-react';
import FMVInteractivePlayer from '../../stages/FMVInteractivePlayer';
import { assetUrl } from '../../stages/utils';

interface FMVPlaygroundViewerProps {
  packagerArtifact?: any;
  sessionId: string;
}

export default function FMVPlaygroundViewer({ packagerArtifact, sessionId }: FMVPlaygroundViewerProps) {
  const [viewMode, setViewMode] = useState<'interactive' | 'master_cut'>('interactive');

  const manifest = packagerArtifact?.fmvManifest;
  const masterVideoUrl = packagerArtifact?.outputVideoUrl || packagerArtifact?.final_video;
  const totalDuration = packagerArtifact?.totalDuration || 0;

  const downloadManifest = () => {
    if (!manifest) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(manifest, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'game_manifest.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* 顶部控制栏 */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl">
          <button
            onClick={() => setViewMode('interactive')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'interactive'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>🎮 互动影游即时试玩</span>
          </button>
          <button
            onClick={() => setViewMode('master_cut')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'master_cut'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>🎬 完整全剧成片合流 ({Math.round(totalDuration)}s)</span>
          </button>
        </div>

        {manifest && (
          <button
            onClick={downloadManifest}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-bold shadow-2xs transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出 game_manifest.json</span>
          </button>
        )}
      </div>

      {/* 主展示区 */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col">
        {viewMode === 'interactive' ? (
          manifest ? (
            <div className="flex-1 min-h-[550px] rounded-2xl overflow-hidden border border-gray-300/80 shadow-md bg-slate-900">
              <FMVInteractivePlayer
                manifest={manifest}
                sessionId={sessionId}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 text-gray-400">
              <Gamepad2 className="w-12 h-12 mb-3 text-gray-300 animate-pulse" />
              <p className="text-sm font-medium">正在生成决策呼吸微循环并装配影游状态机工程包...</p>
            </div>
          )
        ) : (
          /* 完整连续成片播放 */
          <div className="max-w-4xl mx-auto w-full space-y-4">
            <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black shadow-lg border border-gray-200">
              {masterVideoUrl ? (
                <video
                  src={assetUrl(masterVideoUrl)}
                  controls
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                  成片剪辑中...
                </div>
              )}
            </div>
            <div className="p-4 rounded-xl bg-white border border-gray-200 text-xs text-gray-600">
              💡 本成片由 FFmpeg 自动串联全部镜头视频，并智能渲染并混音了电影级环境背景音乐 (BGM)。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
