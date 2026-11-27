/**
 * client/src/components/studio/stages/planner/ScreenplayReviewActionButton.tsx
 * 一体化 AI 剧本质量审查与一键修复动作按钮 (带 Hover 审查浮层与多状态级别划分)
 */

import React, { useState, useRef, useMemo } from 'react';
import type { ReviewFreshnessView, ReviewIssue } from '../../../../types';

export interface ScreenplayReviewActionButtonProps {
  review?: ReviewFreshnessView;
  isReviewing?: boolean;
  isFixing?: boolean;
  fixError?: string | null;
  onFixAll: () => Promise<void> | void;
  onTriggerReview: () => Promise<void> | void;
}

export const ScreenplayReviewActionButton: React.FC<ScreenplayReviewActionButtonProps> = ({
  review,
  isReviewing = false,
  isFixing = false,
  fixError = null,
  onFixAll,
  onTriggerReview,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    closeTimerRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 180);
  };

  // 审查问题与严重级别判定
  const issues: ReviewIssue[] = review?.report?.issues || [];
  const errorCount = useMemo(() => issues.filter((i) => i.severity === 'error').length, [issues]);
  const warningCount = useMemo(() => issues.filter((i) => i.severity !== 'error').length, [issues]);
  const hasCritical = errorCount > 0;

  // 当前按钮状态判定：'fixing' | 'reviewing' | 'failed' | 'actionable' | 'passed' | 'idle_or_stale'
  const buttonState = useMemo<'fixing' | 'reviewing' | 'failed' | 'actionable' | 'passed' | 'idle_or_stale'>(() => {
    if (isFixing) return 'fixing';
    if (isReviewing || review?.status === 'reviewing') return 'reviewing';
    if (fixError || review?.status === 'failed') return 'failed';
    if (review?.status === 'issues_found' && issues.length > 0 && !review?.isStale) return 'actionable';
    if (review?.status === 'passed' && !review?.isStale) return 'passed';
    return 'idle_or_stale';
  }, [isFixing, isReviewing, review?.status, review?.isStale, fixError, issues.length]);

  // 按钮主点击事件
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonState === 'fixing' || buttonState === 'reviewing') {
      return;
    }
    if (buttonState === 'actionable' || buttonState === 'failed') {
      onFixAll();
      return;
    }
    if (buttonState === 'idle_or_stale') {
      onTriggerReview();
      return;
    }
  };

  // 根据状态与级别生成按钮样式 (统一为贴合顶栏风格的柔和浅色 Pill 胶囊，消除宽度跳动与视觉突兀感)
  const buttonStyle = useMemo(() => {
    switch (buttonState) {
      case 'fixing':
        return 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs cursor-wait animate-pulse';

      case 'reviewing':
        return 'bg-sky-50 text-sky-700 border border-sky-200 shadow-2xs cursor-wait animate-pulse';

      case 'failed':
        return 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 shadow-2xs hover:shadow-xs transition';

      case 'actionable':
        if (hasCritical) {
          // 致命硬伤级别：醒目红字浅粉底，清爽警示且不破坏顶栏色调
          return 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 shadow-2xs hover:shadow-xs transition';
        }
        // 普通警告级别：高亮琥珀橙底
        return 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 shadow-2xs hover:shadow-xs transition';

      case 'passed':
        return 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 shadow-2xs transition';

      case 'idle_or_stale':
      default:
        return 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs transition';
    }
  }, [buttonState, hasCritical]);

  return (
    <div
      className="relative inline-flex items-center flex-shrink-0"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 核心主按钮 */}
      <button
        type="button"
        onClick={handleClick}
        disabled={buttonState === 'fixing' || buttonState === 'reviewing'}
        className={`h-7 px-2.5 text-xs font-semibold rounded-lg flex items-center justify-center space-x-1.5 transition-all select-none flex-shrink-0 whitespace-nowrap ${buttonStyle}`}
      >
        {/* 状态 1：修复中 */}
        {buttonState === 'fixing' && (
          <>
            <span className="inline-block animate-spin text-[11px]">⏳</span>
            <span>修复中...</span>
          </>
        )}

        {/* 状态 2：审查中 */}
        {buttonState === 'reviewing' && (
          <>
            <span className="inline-block animate-spin text-[11px]">🔄</span>
            <span>审查中...</span>
          </>
        )}

        {/* 状态 3：修复失败 */}
        {buttonState === 'failed' && (
          <>
            <span>⚠️</span>
            <span>修复失败 · 重试</span>
          </>
        )}

        {/* 状态 4：一键修复 (按严重级别划分) */}
        {buttonState === 'actionable' && (
          <>
            <span>{hasCritical ? '🚨' : '🪄'}</span>
            <span>一键修复 ({issues.length})</span>
          </>
        )}

        {/* 状态 5：审查通过 */}
        {buttonState === 'passed' && (
          <>
            <span>✅</span>
            <span>{warningCount > 0 ? `审查通过 (${warningCount}条建议)` : '审查通过'}</span>
          </>
        )}

        {/* 状态 6：待审查 / 已修改 */}
        {buttonState === 'idle_or_stale' && (
          <>
            <span>{review?.isStale ? '🕒' : '🔍'}</span>
            <span>{review?.isStale ? '待重审' : '审查'}</span>
          </>
        )}
      </button>

      {/* 悬停审查浮层卡片 (仅在存在待修复问题或修复/审查失败时展示) */}
      {isHovered && (buttonState === 'actionable' || buttonState === 'failed') && (
        <div
          className="absolute right-0 top-full mt-2 w-[420px] max-w-[85vw] bg-white rounded-xl shadow-2xl border border-slate-200 z-50 p-4 space-y-3 text-slate-800 animate-in fade-in zoom-in-95 duration-150"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Popover 顶部 Header */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-800 flex items-center space-x-1">
                <span>🛡️</span>
                <span>AI 剧本质量审查档案</span>
              </span>
              {review?.artifactHash && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
                  {review.artifactHash}
                </span>
              )}
            </div>

            {/* 顶部胶囊标签 */}
            {buttonState === 'actionable' && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  hasCritical
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {hasCritical ? `🚨 ${errorCount} 处硬伤待修复` : `⚠️ ${warningCount} 处优化建议`}
              </span>
            )}
            {buttonState === 'failed' && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                ❌ 修复异常
              </span>
            )}
          </div>

          {/* 审查概述摘要 */}
          {!review?.isStale && review?.report?.summary && (
            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50/80 p-2 rounded-lg border border-slate-100">
              {review.report.summary}
            </p>
          )}

          {/* 失败错误提示 */}
          {fixError && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5 space-y-1">
              <div className="font-bold flex items-center space-x-1">
                <span>❌</span>
                <span>上次修复未成功</span>
              </div>
              <div className="text-[11px] font-mono break-all">{fixError}</div>
              <div className="text-[10px] text-rose-500 pt-0.5">请点击按钮重试，系统将重新请求局部精修。</div>
            </div>
          )}

          {/* 审查问题列表 (带滚动条限制高度；剧本更新后旧问题自动隐藏) */}
          {!review?.isStale && issues.length > 0 ? (
            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1 text-left">
              {issues.map((issue, idx) => {
                const isError = issue.severity === 'error';
                return (
                  <div
                    key={issue.id || idx}
                    className={`p-2.5 rounded-lg border space-y-1.5 transition ${
                      isError
                        ? 'bg-rose-50/50 border-rose-200'
                        : 'bg-amber-50/50 border-amber-200'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center space-x-1.5 font-bold">
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] ${
                            isError ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white'
                          }`}
                        >
                          {isError ? '硬伤' : '警告'}
                        </span>
                        {issue.actNumber && (
                          <span className="text-slate-700">第 {issue.actNumber} 幕</span>
                        )}
                        <span className="text-slate-600 font-medium">{issue.category}</span>
                      </div>
                    </div>

                    {/* 原文引用摘录 */}
                    {issue.excerpt && (
                      <div className="text-[11px] text-slate-600 font-mono bg-white/80 p-1.5 rounded border border-slate-200/60 line-clamp-2">
                        “{issue.excerpt}”
                      </div>
                    )}

                    {/* 违规原因与修复指令 */}
                    <div className="text-[11px] text-slate-700 space-y-0.5">
                      <div className="text-slate-600 leading-snug">{issue.reason}</div>
                      {issue.fixInstruction && (
                        <div className="text-indigo-700 font-medium bg-indigo-50/60 px-1.5 py-0.5 rounded text-[10.5px]">
                          💡 修复建议：{issue.fixInstruction}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            !fixError && (
              <div className="text-xs text-slate-500 py-3 text-center">
                剧本审查异常，点击按钮可重新尝试。
              </div>
            )
          )}

          {/* Popover 底部快捷操作引导 */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">
              {buttonState === 'actionable' ? '👆 点击按钮直接一键修复全部' : '点击按钮重试修复或重新审查'}
            </span>
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTriggerReview();
                }}
                className="px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition"
              >
                🔄 重新审查
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
