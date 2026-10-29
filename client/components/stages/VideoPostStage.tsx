'use client';

import React, { useState } from 'react';
import { Film, Clapperboard, Video } from 'lucide-react';
import type { StageViewProps } from './types';
import VideoStage from './VideoStage';
import PostProductionStage from './PostProductionStage';
import StageActions from './StageActions';


export default function VideoPostStage(props: StageViewProps) {
  const [activeTab, setActiveTab] = useState<'clips' | 'final'>('clips');

  // Check if any final video already exists
  const hasFinalVideo = Boolean(
    props.state?.artifact?.final_video ||
    props.state?.artifact?.final_videos?.length ||
    props.artifacts?.post_production?.final_video ||
    props.artifacts?.post_production?.final_videos?.length
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-slate-50">
      {/* 顶部标签切换栏：镜头视频生成 vs 成片剪辑合成 */}
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
        </div>

        <span className="text-xs text-gray-400 hidden sm:inline">
          镜头生成完毕后，可无缝切换至成片剪辑完成全片合成与导出
        </span>
      </div>

      {/* 切换展示相应子工坊 */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {activeTab === 'clips' ? (
          <VideoStage {...props} />
        ) : (
          <PostProductionStage {...props} />
        )}
      </div>
    </div>
  );
}
