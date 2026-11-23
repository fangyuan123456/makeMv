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
import type { ConversationMessage } from '../../../lib/DirectorConversation.js';
import { ProposalCard } from './ProposalCard.js';

export interface DirectorTaskCardProps {
  msg: ConversationMessage<any>;
  tasks?: TaskRecord[];
  displayPercent: number;
  streamingTargetId?: string | null;
  streamingAppendContent?: string;
  onRetry?: () => void;
  onRetryTask?: (taskId: string) => void;
  onCancelPlan?: (taskIds: string[]) => void;
  directorRoleName?: string;
  progressGradientClass?: string;
  onApproveProposal?: (messageId: string) => void;
  isApproving?: boolean;
  isStreaming?: boolean;
  isTaskRunning?: boolean;
}

export const DirectorTaskCard: React.FC<DirectorTaskCardProps> = ({
  msg,
  tasks = [],
  displayPercent,
  streamingTargetId,
  streamingAppendContent,
  onRetry,
  onRetryTask,
  onCancelPlan,
  directorRoleName = 'AI 导演',
  progressGradientClass = 'from-indigo-500 via-indigo-600 to-purple-600',
  onApproveProposal,
  isApproving,
  isStreaming,
  isTaskRunning,
}) => {
  const hasPlanSteps = Array.isArray(msg.planSteps) && msg.planSteps.length > 0;
  const resolvedPlanSteps = hasPlanSteps
    ? msg.planSteps!.map((step) => {
        const live = tasks.find((t) => t.taskId === step.taskId);
        return {
          ...step,
          status: live?.status || step.status,
          progress: live?.progress || step.progress,
          durationMs: live?.durationMs ?? step.durationMs,
          error: live?.error ?? step.error,
        };
      })
    : [];

  const planTotal = resolvedPlanSteps.length;
  const planCompletedCount = resolvedPlanSteps.filter((s) => s.status === 'completed').length;
  const planFailedCount = resolvedPlanSteps.filter((s) => s.status === 'failed').length;
  const planCancelledCount = resolvedPlanSteps.filter((s) => s.status === 'cancelled').length;
  const planActiveSteps = resolvedPlanSteps.filter((s) => s.status === 'pending' || s.status === 'running');

  const liveTask = !hasPlanSteps && msg.taskId ? tasks.find((t) => t.taskId === msg.taskId) : undefined;
  const status = hasPlanSteps
    ? planActiveSteps.length > 0
      ? 'running'
      : planFailedCount > 0
      ? 'failed'
      : planCancelledCount > 0 && planCompletedCount === 0
      ? 'cancelled'
      : 'completed'
    : liveTask?.status ||
      msg.taskStatus ||
      (msg.taskProgress?.percent === 100 ? 'completed' : 'pending');

  const isRunning = status === 'running' || status === 'pending';
  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';
  const isCompleted = status === 'completed';
  const duration = hasPlanSteps
    ? isRunning
      ? undefined
      : resolvedPlanSteps.reduce((sum, s) => sum + (s.durationMs || 0), 0) || msg.taskDurationMs
    : liveTask?.durationMs || msg.taskDurationMs;
  const durationSec = duration ? (duration / 1000).toFixed(1) : undefined;

  // 优先读取结构化对白字段 (leadInSpeech / postSummarySpeech)；
  // 前置对白 (preSpeech) 严格位于进度条上方；
  // 后置复盘总结 (postSummary) 严格位于进度条下方。
  const preSpeech = msg.leadInSpeech || (msg.content.includes('\n\n---\n\n') ? msg.content.split('\n\n---\n\n')[0] : msg.content);
  const postSummary = msg.postSummarySpeech || (msg.content.includes('\n\n---\n\n') ? msg.content.split('\n\n---\n\n').slice(1).join('\n\n---\n\n') : '');
  const isStreamingSummary = streamingTargetId === msg.id;

  // 根据工具名自适应图标
  const getToolIcon = () => {
    if (hasPlanSteps) return '📋';
    const tool = msg.taskTool || '';
    if (tool.includes('screenplay')) return '📜';
    if (tool.includes('prd')) return '📑';
    if (tool.includes('portrait') || tool.includes('character')) return '👤';
    if (tool.includes('scene') || tool.includes('location')) return '🌆';
    if (tool.includes('upscale')) return '✨';
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
        <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 text-[11px] gap-2">
          <div className="flex items-center space-x-1.5 font-bold text-slate-800 truncate min-w-0">
            <span>{getToolIcon()}</span>
            <span className="truncate">【{msg.taskTitle || '制片工序任务'}】</span>
          </div>

          {/* 状态徽标 + 取消全部 */}
          <div className="shrink-0 flex items-center gap-1.5">
            {isRunning && (
              <span className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-medium shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-ping"></span>
                <span className="font-mono">
                  {hasPlanSteps ? `${planCompletedCount}/${planTotal}` : `${displayPercent}%`}
                </span>
                <span className="text-indigo-400">·</span>
                <span>{hasPlanSteps ? '执行中' : '推演中'}</span>
              </span>
            )}
            {hasPlanSteps && isRunning && onCancelPlan && planActiveSteps.length > 0 && (
              <button
                type="button"
                onClick={() => onCancelPlan(planActiveSteps.map((s) => s.taskId))}
                className="px-2 py-0.5 rounded-full bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-500 hover:text-rose-600 text-[10px] font-medium transition cursor-pointer"
                title="取消该计划中剩余未完成的子任务"
              >
                取消全部
              </button>
            )}
            {isCompleted && (
              <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-medium">
                <span>✓ {hasPlanSteps ? `完成 ${planCompletedCount}/${planTotal}` : '已完成'}</span>
                {durationSec ? <span className="font-mono text-[9px] text-emerald-600/80">({durationSec}s)</span> : null}
              </span>
            )}
            {isFailed && (
              <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-medium">
                <span>{hasPlanSteps ? `⚠ 部分失败 (${planCompletedCount}/${planTotal})` : '✕ 执行失败'}</span>
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

        {/* 3. 极细进度条（推演中动态平滑呈现） */}
        {isRunning && (
          <div className="w-full h-1.5 bg-slate-200/70 rounded-full overflow-hidden p-[1px]">
            <div
              className={`h-full bg-gradient-to-r ${progressGradientClass} transition-all duration-300 ease-out rounded-full shadow-2xs`}
              style={{ width: `${Math.max(6, Math.min(100, displayPercent))}%` }}
            />
          </div>
        )}

        {/* 3.5 多步 Plan 子任务执行清单 */}
        {hasPlanSteps && (
          <div className="rounded-xl border border-slate-200/80 bg-white/90 divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {resolvedPlanSteps.map((step, idx) => {
              const stepSec = step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : '';
              const canRetryStep =
                !isRunning &&
                !isStreamingSummary &&
                (step.status === 'failed' || step.status === 'cancelled') &&
                Boolean(onRetryTask);
              return (
                <div
                  key={`${step.taskId}-${idx}`}
                  className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {step.status === 'completed' && (
                      <span className="text-emerald-600 font-bold shrink-0" title="已完成">✓</span>
                    )}
                    {step.status === 'running' && (
                      <span className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0" title="执行中" />
                    )}
                    {step.status === 'pending' && (
                      <span className="text-slate-400 shrink-0" title="排队中">○</span>
                    )}
                    {step.status === 'failed' && (
                      <span className="text-rose-600 font-bold shrink-0" title="执行失败">✕</span>
                    )}
                    {step.status === 'cancelled' && (
                      <span className="text-amber-600 shrink-0" title="已取消">⏹</span>
                    )}
                    <div className="min-w-0">
                      <div
                        className={`truncate font-medium ${
                          step.status === 'pending'
                            ? 'text-slate-500'
                            : step.status === 'failed'
                            ? 'text-rose-700'
                            : 'text-slate-800'
                        }`}
                        title={step.title}
                      >
                        {idx + 1}. {step.title}
                      </div>
                      {step.status === 'running' && step.progress?.message && (
                        <div className="text-[10px] text-indigo-600 truncate">
                          {step.progress.message}
                        </div>
                      )}
                      {step.status === 'failed' && step.error && (
                        <div className="text-[10px] text-rose-500 truncate" title={step.error}>
                          {step.error}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {step.status === 'completed' && stepSec && (
                      <span className="text-[10px] font-mono text-slate-400">{stepSec}</span>
                    )}
                    {step.status === 'pending' && (
                      <span className="text-[10px] text-slate-400">排队中</span>
                    )}
                    {canRetryStep && (
                      <button
                        type="button"
                        onClick={() => onRetryTask?.(step.taskId)}
                        className="px-1.5 py-0.5 rounded-md bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 text-[10px] font-semibold cursor-pointer transition"
                      >
                        重试
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(isCompleted || (hasPlanSteps && !isRunning)) && (postSummary || isStreamingSummary) && (
          <div className="border-t border-slate-200/60 my-1" />
        )}

        {/* 4. 执行结果与收官复盘（严格位于进度条/清单下方） */}
        {isStreamingSummary && (
          <div className="text-slate-800">
            <div className="whitespace-pre-wrap leading-relaxed">{streamingAppendContent}</div>
            <span className="inline-block w-1.5 h-3 bg-indigo-600 ml-1 animate-pulse align-middle"></span>
          </div>
        )}

        {postSummary && !isStreamingSummary && (
          <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
            {postSummary}
          </div>
        )}

        {/* 5. 若本工序在复盘收官时推演产出了下一步新提案，直接内嵌于卡片底部，消灭多余气泡 */}
        {msg.proposal &&
          msg.proposal.action === 'propose' &&
          !msg.proposalResolved &&
          !isStreamingSummary && (
            <ProposalCard
              proposal={msg.proposal}
              onApprove={() => onApproveProposal?.(msg.id)}
              disabled={isApproving || isStreaming || isTaskRunning}
            />
          )}

        {/* 单任务失败重试（多步 Plan 的重试直接内嵌在各失败步骤行内） */}
        {!hasPlanSteps && isFailed && (
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
