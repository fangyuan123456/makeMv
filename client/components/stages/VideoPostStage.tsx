'use client';

import React, { useState } from 'react';
import { Film, Video, Gamepad2 } from 'lucide-react';
import type { StageViewProps } from './types';
import VideoStage from './VideoStage';
import PostProductionStage from './PostProductionStage';
import FMVInteractivePlayer from './FMVInteractivePlayer';

export default function VideoPostStage(props: StageViewProps) {
  const [activeTab, setActiveTab] = useState<'clips' | 'final' | 'interactive'>('clips');

  // Check if any final video or FMV manifest exists
  const hasFinalVideo = Boolean(
    props.state?.artifact?.final_video ||
    props.state?.artifact?.final_videos?.length ||
    props.artifacts?.post_production?.final_video ||
    props.artifacts?.post_production?.final_videos?.length
  );

  const manifest =
    props.state?.artifact?.fmvManifest ||
    props.artifacts?.post_production?.fmvManifest ||
    props.artifacts?.video_post?.fmvManifest;

  return (
    <div className="flex h-full min-w-0 flex-col bg-slate-50">
      {/* 顶部标签切换栏：镜头生成 vs 成片剪辑 vs 影游试玩 */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 p-1 bg-gray-100 rounded-xl">
          <button
            onClick={() => setActiveTab('clips')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'clips'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>1. 分镜头视频生成</span>
          </button>

          <button
            onClick={() => setActiveTab('final')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'final'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>2. 成片剪辑与合成</span>
            {hasFinalVideo && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('interactive')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'interactive'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>3. 影游交互试玩</span>
            {manifest && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-mono font-bold">
                可玩
              </span>
            )}
          </button>
        </div>

        <span className="text-xs text-gray-400 hidden sm:inline">
          成片合成后，可直接切换至【影游交互试玩】体验实时分支跳转与倒计时抉择
        </span>
      </div>

      {/* 切换展示相应子工坊 */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {activeTab === 'clips' && <VideoStage {...props} />}
        {activeTab === 'final' && <PostProductionStage {...props} />}
        {activeTab === 'interactive' && (
          <div className="h-full p-4 sm:p-8 overflow-y-auto max-w-5xl mx-auto flex flex-col justify-center">
            <FMVInteractivePlayer manifest={manifest} sessionId={props.sessionId} />
          </div>
        )}
      </div>
    </div>
  );
}
