/**
 * client/src/components/ProposalCard.tsx
 * 导演意图决策卡片 (Action Proposal Card - Human-in-the-Loop)
 */

import React from 'react';
import type { ActionProposal } from '../types/index.js';

interface ProposalCardProps {
  proposal: ActionProposal;
  onApprove: (proposal: ActionProposal) => void;
  onReject?: (proposal: ActionProposal) => void;
  isExecuting?: boolean;
}

/** 统一输出底部确认按钮文案（与输入栏内联按钮单一事实来源对齐） */
export function getProposalButtonLabel(proposal: ActionProposal): string {
  if (proposal.action === 'build_text_game' || proposal.targetStage === 'build_text_game') {
    return '生成可玩互动文游';
  }
  switch (proposal.action) {
    case 'propose_stage':
    case 'start_pipeline':
      return '启动全案策划推演';
    case 'resume_task':
      return '恢复并继续执行';
    case 'approve_stage':
      return proposal.targetStage === 'compile_film' ? '编译影游切片' : '确认进入下一阶段';
    case 'modify_asset':
      return '确认定向精修';
    case 'render_images':
      return '确认批量生成关键帧';
    default:
      return '确认并启动';
  }
}

export const ProposalCard: React.FC<ProposalCardProps> = ({
  proposal,
  onApprove,
  onReject,
  isExecuting = false,
}) => {
  const getActionLabel = (action: string) => {
    switch (action) {
      case 'propose_stage':
      case 'start_pipeline':
        return '🚀 提议立项推演';
      case 'resume_task':
        return '🔄 提议恢复中断任务';
      case 'approve_stage':
        return '✨ 提议推进下一阶段';
      case 'modify_asset':
        return '🎯 提议定向精修';
      case 'build_text_game':
        return '🎮 提议直接生成可玩文游';
      case 'render_images':
        return '🖼️ 提议批量生成关键帧';
      default:
        return '💡 导演行动提议';
    }
  };

  return (
    <div className="proposal-card">
      <div className="proposal-badge">{getActionLabel(proposal.action)}</div>
      <div className="proposal-summary">{proposal.summary}</div>

      <div className="proposal-actions">
        <button
          className="btn btn-success"
          disabled={isExecuting}
          onClick={() => onApprove(proposal)}
        >
          {isExecuting ? '⏳ 执行中...' : '✅ 授权开工 (Approve)'}
        </button>

        {onReject && (
          <button
            className="btn btn-secondary"
            disabled={isExecuting}
            onClick={() => onReject(proposal)}
          >
            ❌ 驳回调整
          </button>
        )}
      </div>
    </div>
  );
};
