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
  const description = proposal.description;
  const operations = Array.isArray(proposal.operations) ? proposal.operations : [];

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
      {operations.length > 0 && (
        operations.length > 1 ? (
          <div className="rounded-lg border border-amber-200/80 bg-white/80 p-2 space-y-1 max-h-40 overflow-y-auto">
            <div className="text-[10px] font-bold text-amber-800/90 px-1 pb-0.5 flex items-center justify-between">
              <span>执行计划清单</span>
              <span className="font-mono">共 {operations.length} 步</span>
            </div>
            {operations.map((operation: any, index: number) => (
              <div
                key={index}
                className="flex items-center gap-1.5 text-[11px] text-slate-700 px-1 py-0.5 rounded hover:bg-amber-50/70"
              >
                <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-800 font-mono text-[9px] font-bold flex items-center justify-center shrink-0">
                  {index + 1}
                </span>
                <span className="truncate">{operation.title || `步骤 ${index + 1}`}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-700">
            {operations.map((operation: any, index: number) => (
              <span key={index} className="rounded border border-amber-200 bg-white/70 px-2 py-0.5">
                {operation.title || `步骤 ${index + 1}`}
              </span>
            ))}
          </div>
        )
      )}
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
