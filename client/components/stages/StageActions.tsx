'use client';

import React, { useState, useCallback } from 'react';
import { CheckCircle, Edit3, Check, Loader2 } from 'lucide-react';
import type { StageStatus } from './types';

interface StageActionsProps {
  status: StageStatus;
  onConfirm: () => void;
  onEdit?: () => void;
  onSave?: () => void;
  onSaveSelections?: () => Promise<void>;
  onRegenerate?: () => void;
  /** 阶段ID */
  stageId?: string;
  /** 是否有待生成的项（用于阶段2、3、4、5） */
  hasPendingItems?: boolean;
  /** 后续阶段是否已开始（用于阶段1） */
  hasNextStageStarted?: boolean;
  /** 是否显示"确认并继续"按钮（后续阶段已执行过时隐藏） */
  showConfirm?: boolean;
  isRunning: boolean;
  /** 是否禁用确认按钮 */
  disabledConfirm?: boolean;
  /** 禁用提示 */
  disabledConfirmMessage?: string;
  /** 自动保存状态 */
  autoSaveStatus?: 'idle' | 'saving' | 'saved';
}

export default function StageActions({
  status,
  onConfirm,
  onEdit,
  onSave,
  onSaveSelections,
  onRegenerate,
  stageId = '',
  hasPendingItems = true,
  hasNextStageStarted = false,
  showConfirm = true,
  isRunning,
  disabledConfirm = false,
  disabledConfirmMessage = '',
  autoSaveStatus = 'saved',
}: StageActionsProps) {
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // 修改/保存按钮：waiting/running/completed/stopped 状态显示
  const showActions = status === 'waiting' || status === 'running' || status === 'completed' || status === 'stopped';
  // 保存选择按钮：有 onSaveSelections 且 waiting/completed/stopped 状态显示
  const showSaveSelections = onSaveSelections && (status === 'waiting' || status === 'completed' || status === 'stopped');
  // "确认并继续"按钮：showConfirm=true 且 waiting/running/completed 时显示，stopped 状态不显示
  const showConfirmBtn = showConfirm && (status === 'waiting' || status === 'running' || status === 'completed');

  const handleSaveClick = useCallback(async () => {
    if (!onSaveSelections || saveState !== 'idle') return;
    setSaveState('saving');
    try {
      await onSaveSelections();
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch {
      setSaveState('idle');
    }
  }, [onSaveSelections, saveState]);

  if (!showConfirmBtn && !showActions) return null;

  return (
    <div className="border-t border-gray-200 bg-white px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
      {/* 左侧：自动保存状态提示 */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-600 font-medium">
          {autoSaveStatus === 'saving' || saveState === 'saving' ? (
            <>
              <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
              <span>正在自动保存...</span>
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>已启用自动保存 · 实时同步</span>
            </>
          )}
        </span>
      </div>

      {/* 右侧：操作按钮组 */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {showActions && onEdit && (
          <button
            onClick={onEdit}
            disabled={isRunning}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <Edit3 className="w-4 h-4" />
            修改
          </button>
        )}

        {showConfirmBtn && (
          <button
            onClick={onConfirm}
            disabled={isRunning || disabledConfirm}
            title={disabledConfirm ? (disabledConfirmMessage || '请先完成前置定妆要求') : ''}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"
          >
            <CheckCircle className="w-4 h-4" />
            确认并继续
          </button>
        )}
      </div>
    </div>
  );
}
