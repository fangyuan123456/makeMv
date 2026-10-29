'use client';

import React from 'react';
import { Square } from 'lucide-react';

interface StageLoadingOverlayProps {
  stageId?: string;
  stageName: string;
  stageIndex?: number;
  totalStages?: number;
  progress?: number;
  progressMessage?: string;
  onStop?: () => void;
}

export default function StageLoadingOverlay({
  stageName,
  progressMessage,
  onStop,
}: StageLoadingOverlayProps) {
  const displayMsg = progressMessage?.includes(': ')
    ? progressMessage.split(': ').slice(1).join(': ')
    : progressMessage;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white/70 backdrop-blur-xs select-none">
      <div className="flex flex-col items-center gap-3.5">
        {/* 经典 12 瓣放射状转菊花 */}
        <div className="relative w-12 h-12 animate-spin">
          {[...Array(12)].map((_, i) => (
            <span
              key={i}
              className="absolute w-1 h-3 bg-gray-600 rounded-full left-[22px] top-0 origin-[2px_24px]"
              style={{
                transform: `rotate(${i * 30}deg)`,
                opacity: 0.15 + (i / 11) * 0.85,
              }}
            />
          ))}
        </div>

        {/* 简洁文案 */}
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-gray-700">
            正在生成{stageName}...
          </p>
          {displayMsg && displayMsg !== stageName && displayMsg !== '执行中...' && (
            <p className="text-xs text-gray-400 max-w-xs truncate">
              {displayMsg}
            </p>
          )}
        </div>

        {/* 停止按钮 */}
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-medium transition-colors ring-1 ring-red-200 cursor-pointer pointer-events-auto"
            title="停止执行"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>停止生成</span>
          </button>
        )}
      </div>
    </div>
  );
}
