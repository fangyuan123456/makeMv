/**
 * client/src/components/studio/chat/DirectorTaskCard.tsx
 * 全系统对话机器人统一任务推演卡片 (Director Task Card SSOT)
 *
 * 核心微内核架构：
 * 1. 结构与生命周期 100% 对齐故事总监标杆体系；
 * 2. 头部展示工序标识与动态进度徽标 (⏳ XX% · 推演中 / ✓ 已完成 (X.Xs) / ✕ 执行失败 / ⏹ 已取消)；
 * 3. 严格分层：前置授权对白在进度条上方，收官复盘总结在进度条/分割线下方；
 * 4. 实时流式打字与落盘持久化无缝承接；
 * 5. 失败态具备错误诊断与一键重试按钮。
 */

import React from 'react';
import type { TaskRecord } from '../../../types/index.js';
import type { ChatMessageItem } from '../../../lib/ChatSession.js';
import { ProposalCard } from './ProposalCard.js';

export interface DirectorTaskCardProps {
  msg: ChatMessageItem<any>;
  tasks?: TaskRecord[];
  nowTick: number;
  displayPercent: number;
  streamingTargetId?: string | null;
  streamingAppendContent?: string;
  onRetry?: () => void;
  onApprove?: () => void;
  canApprove?: boolean;
  proposalAccentClassName?: string;
  directorRoleName?: string;
  progressGradientClass?: string;
}

export const DirectorTaskCard: React.FC<DirectorTaskCardProps> = ({
  msg,
  tasks = [],
  nowTick,
  displayPercent,
  streamingTargetId,
  streamingAppendContent,
  onRetry,
  onApprove,
  canApprove = false,
  proposalAccentClassName,
  directorRoleName = 'AI 导演',
  progressGradientClass = 'from-indigo-500 via-indigo-600 to-purple-600',
}) => {
  const liveTask = msg.taskId ? tasks.find((t) => t.taskId === msg.taskId) : undefined;
  const status =
    liveTask?.status ||
    msg.taskStatus ||
    (msg.taskProgress?.percent === 100 ? 'completed' : 'completed');
  const isRunning = status === 'running' || status === 'pending';
  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';
  const isCompleted = status === 'completed';
  const duration = liveTask?.durationMs || msg.taskDurationMs;
  const durationSec = duration ? (duration / 1000).toFixed(1) : undefined;

  // 将对白正文与落盘后的执行结果/复盘文本拆分：
  // 前置对白 (preSpeech) 严格位于进度条上方；
  // 后置复盘总结 (postSummary) 严格位于进度条下方。
  const contentParts = (msg.content || '').split('\n\n---\n\n');
  const preSpeech = contentParts[0] || '';
  const postSummary = contentParts.slice(1).join('\n\n---\n\n');

  // 根据工具名自适应图标
  const getToolIcon = () => {
    const tool = msg.taskTool || '';
    if (tool.includes('screenplay')) return '📜';
    if (tool.includes('prd')) return '📑';
    if (tool.includes('portrait') || tool.includes('character')) return '👤';
    if (tool.includes('scene') || tool.includes('location')) return '🌆';
    if (tool.includes('storyboard')) return '🎬';
    if (tool.includes('video')) return '🎥';
    return '🎬';
  };

  return (
    <div className="flex flex-col items-start space-y-1.5 w-full">
      <div className="flex items-center space-x-1.5 px-1">
        <span className="text-[10px] font-medium text-slate-400">{directorRoleName}</span>
      </div>

      <div className="max-w-[90%] w-full p-3.5 rounded-2xl rounded-tl-xs bg-slate-50/90 border border-slate-200/80 text-xs text-slate-800 leading-relaxed shadow-2xs space-y-2.5">
        {/* 1. 顶部紧凑任务状态行 */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 text-[11px]">
          <div className="flex items-center space-x-1.5 font-bold text-slate-800 truncate mr-2">
            <span>{getToolIcon()}</span>
            <span className="truncate">【{msg.taskTitle || '制片工序任务'}】</span>
          </div>

          {/* 状态徽标 */}
          <div className="shrink-0">
            {isRunning && (
              <span className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-medium shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-ping"></span>
                <span className="font-mono">{displayPercent}%</span>
                <span className="text-indigo-400">·</span>
                <span>推演中</span>
              </span>
            )}
            {isCompleted && (
              <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-medium">
                <span>✓ 已完成</span>
                {durationSec ? <span className="font-mono text-[9px] text-slate-400">({durationSec}s)</span> : null}
              </span>
            )}
            {isFailed && (
              <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-medium">
                <span>✕ 执行失败</span>
              </span>
            )}
            {isCancelled && (
              <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-medium">
                <span>⏹ 已取消</span>
              </span>
            )}
          </div>
        </div>

        {/* 2. 前置授权与说明对白（严格位于进度条上方） */}
        {preSpeech && (
          <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
            {preSpeech}
          </div>
        )}

        {/* 3. 极细进度条（推演中动态平滑呈现）/ 轻盈分割线（完成态呈现） */}
        {isRunning && (
          <div className="w-full h-1.5 bg-slate-200/70 rounded-full overflow-hidden p-[1px]">
            <div
              className={`h-full bg-gradient-to-r ${progressGradientClass} transition-all duration-300 ease-out rounded-full shadow-2xs`}
              style={{ width: `${Math.max(6, Math.min(100, displayPercent))}%` }}
            />
          </div>
        )}
        {isCompleted && (postSummary || (streamingTargetId === msg.id && streamingAppendContent)) && (
          <div className="border-t border-slate-200/60 my-1" />
        )}

        {/* 4. 执行结果与收官复盘（严格位于进度条下方） */}
        {/* 实时流式打字追加区域（当正在流式生成该任务的复盘时呈现） */}
        {streamingTargetId === msg.id && streamingAppendContent && (
          <div className="text-slate-800">
            <div className="whitespace-pre-wrap leading-relaxed">{streamingAppendContent}</div>
            <span className="inline-block w-1.5 h-3 bg-indigo-600 ml-1 animate-pulse align-middle"></span>
          </div>
        )}

        {/* 已落盘物理固化的收官复盘结果 */}
        {postSummary && (
          <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
            {postSummary}
          </div>
        )}

        {msg.proposal && msg.proposalState === 'pending' && canApprove && onApprove && (
          <ProposalCard
            proposal={msg.proposal}
            onApprove={onApprove}
            accentClassName={proposalAccentClassName}
          />
        )}

        {/* 失败重试 */}
        {isFailed && (
          <div className="pt-2 border-t border-rose-100 flex items-center justify-between text-rose-700 text-[11px]">
            <span className="truncate mr-2">{liveTask?.error || msg.taskError || '算力或网络异常'}</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="underline font-bold text-rose-600 shrink-0 cursor-pointer"
              >
                重试
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
