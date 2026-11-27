/**
 * client/src/components/studio/stages/GameStage.tsx
 * 工序 3：互动影游集成总装工坊 (Game Studio)
 */

import React, { useState } from 'react';
import type { ProjectData, TaskRecord } from '../../../types/index.js';
import { DirectorFloatingBubble } from '../chat/DirectorFloatingBubble.js';

interface GameStageProps {
  projectId: string;
  projectData: ProjectData | null;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
  isBusy: boolean;
}

export const GameStage: React.FC<GameStageProps> = ({
  projectId,
  projectData,
  tasks = [],
  onRunTool,
  onRefreshProject,
  isBusy,
}) => {
  const [iframeKey, setIframeKey] = useState(0);

  // 拼接游戏静态入口地址
  const gameUrl = `/media/${encodeURIComponent(projectId)}/game-assembly/index.html`;

  const hasGamePrd = Boolean(projectData?.prd?.clips?.length || projectData?.artifacts?.prd?.clips?.length);

  const handleGenerateGamePrd = async () => {
    await onRunTool('game.prd', {});
    onRefreshProject?.();
  };

  const handleAssembleGame = async () => {
    await onRunTool('game.assembly', {});
  };

  const handleReloadGame = () => {
    setIframeKey((prev) => prev + 1);
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      {/* 顶部操作栏 */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 mb-4 flex flex-wrap items-center justify-between gap-4 flex-shrink-0 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xl shadow-xs">
            🎮
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">互动影游独立站点总装</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              零构建原生 ES Module 静态站点，浏览器直接可玩
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleGenerateGamePrd}
            disabled={isBusy}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition disabled:opacity-40 shadow-2xs ${
              hasGamePrd
                ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                : 'bg-white hover:bg-indigo-50 text-indigo-700 border-indigo-200'
            }`}
          >
            {hasGamePrd ? '✅ 已生成游戏 PRD' : '📐 生成游戏 PRD'}
          </button>
          <button
            onClick={handleAssembleGame}
            disabled={isBusy}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-40 shadow-sm shadow-indigo-600/20"
          >
            🚀 一键编译打包影游
          </button>
          <button
            onClick={handleReloadGame}
            className="px-3.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 shadow-2xs transition"
          >
            🔄 刷新试玩
          </button>
          <a
            href={gameUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 shadow-2xs transition"
          >
            🌐 独立新窗口打开
          </a>
        </div>
      </div>

      {/* 游戏现场试玩容器 */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200/90 overflow-hidden relative shadow-sm flex flex-col">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500 font-mono">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            <span className="ml-2 truncate max-w-sm text-slate-400 text-[11px]">{gameUrl}</span>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">Live Stage Preview</span>
        </div>

        <div className="flex-1 w-full h-full relative bg-slate-950">
          <iframe
            key={iframeKey}
            src={gameUrl}
            title="互动影游现场试玩"
            className="w-full h-full border-0 bg-black"
          />
        </div>
      </div>

      {/* 游戏总装与调优悬浮导演机器人 */}
      <DirectorFloatingBubble
        mode="game"
        projectId={projectId}
        tasks={tasks}
        onRefreshProject={onRefreshProject}
      />
    </div>
  );
};
