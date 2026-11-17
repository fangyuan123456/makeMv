import React from 'react';

interface ProposalCardProps {
  proposal: any;
  onApprove: () => void;
  disabled?: boolean;
  accentClassName?: string;
}

export const ProposalCard: React.FC<ProposalCardProps> = ({
  proposal,
  onApprove,
  disabled = false,
  accentClassName = 'bg-indigo-600 hover:bg-indigo-700',
}) => {
  const description = proposal.description || proposal.reasoning;

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900">
          <span>📋</span>
          <span>待审提案</span>
        </div>
        <span className="text-[10px] text-amber-700/80">等待授权</span>
      </div>
      <div className="text-xs font-semibold text-slate-800">{proposal.title || '制片工序方案'}</div>
      {description && <div className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">{description}</div>}
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled}
          className={`px-3.5 py-2 ${accentClassName} text-white font-semibold rounded-lg text-xs transition shadow-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
        >
          ✨ 批准执行
        </button>
      </div>
    </div>
  );
};
