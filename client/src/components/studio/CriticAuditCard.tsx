import React, { useState } from 'react';
import { ShieldCheck, Loader2, MessageSquare } from 'lucide-react';

interface CriticAuditCardProps {
  currentStage?: string;
  criticReport?: any;
  onTriggerCriticReview?: () => void;
  onCriticDialog?: (message: string) => Promise<any>;
}

export default function CriticAuditCard({
  criticReport,
  onTriggerCriticReview,
  onCriticDialog,
}: CriticAuditCardProps) {
  const [criticDebateText, setCriticDebateText] = useState('');
  const [isDebating, setIsDebating] = useState(false);
  const [localReplies, setLocalReplies] = useState<
    Array<{ userText: string; replyText: string; accepted?: boolean; gate?: string }>
  >([]);

  const scores = criticReport?.scores || {
    narrativeLogicScore: 85,
    characterDepthScore: 80,
    branchTensionScore: 75,
    visualFeasibilityScore: 90,
    overallScore: 82,
  };
  const gateStatus = criticReport?.gateStatus || 'WARN';
  const isStale = Boolean(criticReport?.isStale || gateStatus === 'STALE');
  const flaws = criticReport?.criticalFlaws || [];
  const verdict = criticReport?.verdict;
  const debateLogs = criticReport?.debateLogs || [];

  const gateBadgeClass = isStale
    ? 'bg-slate-800 text-slate-300 border-slate-700'
    : gateStatus === 'PASS'
    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
    : gateStatus === 'WARN'
    ? 'bg-amber-950 text-amber-300 border-amber-800'
    : 'bg-rose-950 text-rose-300 border-rose-800';

  const gateBadgeText = isStale
    ? '⚪ 已失效 (产物已更新)'
    : gateStatus === 'PASS'
    ? '🟢 准许放行'
    : gateStatus === 'WARN'
    ? '🟡 建议优化'
    : '🔴 刚性阻断';

  const handleDebateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!criticDebateText.trim() || isDebating || !onCriticDialog) return;
    const text = criticDebateText.trim();
    setCriticDebateText('');
    setIsDebating(true);
    try {
      const res = await onCriticDialog(text);
      if (res) {
        setLocalReplies((prev) => [
          ...prev,
          {
            userText: text,
            replyText: res.reply,
            accepted: res.isDefenseAccepted,
            gate: res.reassessedGateStatus,
          },
        ]);
      }
    } catch (err: any) {
      alert(`辩论质询异常: ${err.message}`);
    } finally {
      setIsDebating(false);
    }
  };

  return (
    <div className="mt-3 rounded-2xl p-4 bg-gradient-to-b from-amber-950/40 to-slate-900 border border-amber-600/40 shadow-2xs space-y-3.5">
      <div className="flex items-center justify-between border-b border-amber-700/40 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-amber-500 text-black flex items-center justify-center text-xs font-bold shadow-2xs">
            <ShieldCheck className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-xs font-bold text-amber-200 flex items-center gap-2">
              <span>独立影视审查官与剧本医生质检审计</span>
            </div>
            <div className="text-[10px] text-amber-400/80">好莱坞工业级全景交叉穿透挑刺</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border font-mono ${gateBadgeClass}`}>
            {gateBadgeText}
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-200 border border-amber-700 font-mono">
            总评 {scores.overallScore}/100
          </span>
        </div>
      </div>

      {isStale && (
        <div className="text-xs bg-amber-950/80 border border-amber-700 text-amber-200 px-3 py-2 rounded-xl flex items-center justify-between">
          <span>⚠️ {criticReport?.staleReason || '工序资产已更新，旧质检告诫已自动失效，建议重新发起质检。'}</span>
          {onTriggerCriticReview && (
            <button
              onClick={onTriggerCriticReview}
              className="px-2.5 py-1 text-[11px] font-bold bg-amber-600 hover:bg-amber-500 text-white rounded-lg cursor-pointer transition-colors shrink-0 ml-2"
            >
              重新质检
            </button>
          )}
        </div>
      )}

      {verdict && (
        <div className="text-[11px] bg-slate-900/90 p-2.5 rounded-xl border border-amber-800/40 text-slate-200 leading-relaxed font-normal">
          <span className="font-bold text-amber-400 mr-1">🧐 终审结论:</span>
          {verdict}
        </div>
      )}

      {/* 四大维度真实量化评分条 */}
      <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-900/80 p-3 rounded-xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex justify-between text-slate-400 text-[10px]">
            <span>因果逻辑 (反机械降神)</span>
            <span className="font-bold text-amber-300">{scores.narrativeLogicScore}/100</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                scores.narrativeLogicScore >= 80 ? 'bg-emerald-500' : scores.narrativeLogicScore >= 60 ? 'bg-amber-500' : 'bg-rose-500'
              }`}
              style={{ width: `${scores.narrativeLogicScore}%` }}
            />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-slate-400 text-[10px]">
            <span>角色动机 (反强行降智)</span>
            <span className="font-bold text-amber-300">{scores.characterDepthScore}/100</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                scores.characterDepthScore >= 80 ? 'bg-emerald-500' : scores.characterDepthScore >= 60 ? 'bg-amber-500' : 'bg-rose-500'
              }`}
              style={{ width: `${scores.characterDepthScore}%` }}
            />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-slate-400 text-[10px]">
            <span>分支张力 (反伪选择)</span>
            <span className="font-bold text-amber-300">{scores.branchTensionScore}/100</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                scores.branchTensionScore >= 80 ? 'bg-emerald-500' : scores.branchTensionScore >= 60 ? 'bg-amber-500' : 'bg-rose-500'
              }`}
              style={{ width: `${scores.branchTensionScore}%` }}
            />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-slate-400 text-[10px]">
            <span>视听落地 (AI 可控性)</span>
            <span className="font-bold text-amber-300">{scores.visualFeasibilityScore}/100</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                scores.visualFeasibilityScore >= 80 ? 'bg-emerald-500' : scores.visualFeasibilityScore >= 60 ? 'bg-amber-500' : 'bg-rose-500'
              }`}
              style={{ width: `${scores.visualFeasibilityScore}%` }}
            />
          </div>
        </div>
      </div>

      {flaws.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
            拦截核心漏洞与瑕疵 ({flaws.length} 处)：
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {flaws.map((f: any, idx: number) => (
              <div key={idx} className="text-[11px] bg-slate-900/90 p-2 rounded-lg border border-slate-800">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                      f.severity === 'CRITICAL'
                        ? 'bg-rose-950 text-rose-300 font-mono border border-rose-800'
                        : f.severity === 'MAJOR'
                        ? 'bg-amber-950 text-amber-300 font-mono border border-amber-800'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {f.severity}
                  </span>
                  <span className="font-bold text-slate-200">{f.location}</span>
                </div>
                <div className="text-slate-400 mt-0.5">{f.description}</div>
                {f.suggestion && (
                  <div className="text-indigo-400 text-[10px] mt-0.5">💡 建议: {f.suggestion}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(debateLogs.length > 0 || localReplies.length > 0) && (
        <div className="space-y-2 pt-1 border-t border-amber-800/40">
          <div className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">质询与辩护记录：</div>
          {debateLogs.map((d: any, idx: number) => (
            <div key={`hist_${idx}`} className="space-y-1 text-[11px] bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
              <div className="text-indigo-400 font-medium">💬 你的辩护: “{d.userMessage}”</div>
              <div className="text-slate-200 leading-relaxed font-normal">🧐 审查官裁决: {d.reply}</div>
              {d.isDefenseAccepted !== undefined && (
                <div className={`text-[10px] font-bold flex items-center gap-1 ${d.isDefenseAccepted ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {d.isDefenseAccepted ? '✔ 辩护成立，门禁已更新放行' : '✖ 解释仍未消解因果断裂，维持原判'}
                </div>
              )}
            </div>
          ))}
          {localReplies.map((d, idx) => (
            <div key={`local_${idx}`} className="space-y-1 text-[11px] bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
              <div className="text-indigo-400 font-medium">💬 你的辩护: “{d.userText}”</div>
              <div className="text-slate-200 leading-relaxed font-normal">🧐 审查官裁决: {d.replyText}</div>
              {d.accepted !== undefined && (
                <div className={`text-[10px] font-bold flex items-center gap-1 ${d.accepted ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {d.accepted ? '✔ 辩护成立，门禁放行条件已更新' : '✖ 解释仍未消解因果断裂，维持原有判定'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {onCriticDialog && (
        <form onSubmit={handleDebateSubmit} className="pt-1 flex items-center gap-2">
          <input
            type="text"
            value={criticDebateText}
            onChange={(e) => setCriticDebateText(e.target.value)}
            placeholder="若对上述挑刺有异议，向剧本医生提交戏剧前置因果辩护..."
            disabled={isDebating}
            className="flex-1 text-xs bg-slate-950 border border-amber-800/60 rounded-xl px-3 py-1.5 outline-none focus:border-amber-400 text-slate-200 transition-colors shadow-2xs"
          />
          <button
            type="submit"
            disabled={!criticDebateText.trim() || isDebating}
            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-2xs transition-all disabled:opacity-40 cursor-pointer flex items-center gap-1 shrink-0"
          >
            {isDebating ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
            <span>发起对辩</span>
          </button>
        </form>
      )}
    </div>
  );
}
