/**
 * agents/pipeline/workflows/steps/critic-review/evaluator.ts
 * 独立审查官挑刺评分归一化与放行门禁仲裁算法 (Critic Review Evaluator SSOT)
 */

import type { CriticAuditReportOutput } from './schema.js';

export interface EvaluationInput {
  rawReport: any;
  projectName: string;
  activeStage: string;
}

export interface EvaluationResult {
  finalReport: CriticAuditReportOutput;
  gateBadge: string;
  flawsText: string;
  summary: string;
}

export function evaluateCriticAudit(input: EvaluationInput): EvaluationResult {
  const { rawReport, projectName, activeStage } = input;

  const subScores = [
    rawReport.scores?.narrativeLogicScore,
    rawReport.scores?.characterDepthScore,
    rawReport.scores?.branchTensionScore,
    rawReport.scores?.visualFeasibilityScore,
  ].filter((s): s is number => typeof s === 'number');

  const computedOverall = subScores.length > 0
    ? Math.round(subScores.reduce((a, b) => a + b, 0) / subScores.length)
    : 75;

  const overallScore = Math.min(100, Math.max(0, Number(rawReport.scores?.overallScore ?? computedOverall)));
  const flawsList = Array.isArray(rawReport.criticalFlaws) ? rawReport.criticalFlaws : [];
  const hasCriticalFlaw = flawsList.some((f: any) => f.severity === 'CRITICAL');

  let gateStatus: 'PASS' | 'WARN' | 'FAIL' = 'WARN';
  if (overallScore >= 80 && !hasCriticalFlaw) {
    gateStatus = 'PASS';
  } else if (overallScore < 60 || hasCriticalFlaw) {
    gateStatus = 'FAIL';
  }

  const finalReport: CriticAuditReportOutput = {
    projectName,
    stageReviewed: activeStage,
    gateStatus,
    thoughtChain: rawReport.thoughtChain || '审查官已完成因果逻辑链条推演。',
    crossStageInsights: rawReport.crossStageInsights,
    scores: {
      narrativeLogicScore: Number(rawReport.scores?.narrativeLogicScore ?? 70),
      characterDepthScore: Number(rawReport.scores?.characterDepthScore ?? 70),
      branchTensionScore: Number(rawReport.scores?.branchTensionScore ?? 70),
      visualFeasibilityScore: Number(rawReport.scores?.visualFeasibilityScore ?? 70),
      overallScore,
    },
    criticalFlaws: flawsList.map((f: any) => ({
      severity: f.severity || 'MAJOR',
      dimension: f.dimension || 'LOGIC',
      location: f.location || '全局戏剧主干',
      description: f.description || '',
      suggestion: f.suggestion || '',
    })),
    polishSuggestions: Array.isArray(rawReport.polishSuggestions) ? rawReport.polishSuggestions : [],
    verdict: rawReport.verdict || '完成全景交叉质检审查。',
  };

  const gateBadge = finalReport.gateStatus === 'PASS'
    ? '🟢【准许放行】'
    : finalReport.gateStatus === 'WARN'
    ? '🟡【建议优化】'
    : '🔴【刚性阻断】';

  const criticalCount = finalReport.criticalFlaws.filter((f) => f.severity === 'CRITICAL').length;
  const flawsText = finalReport.criticalFlaws.length > 0
    ? `发现 ${finalReport.criticalFlaws.length} 处关键瑕疵（包含 ${criticalCount} 个致命漏洞）`
    : '未发现严重逻辑漏洞';

  const summary = `🧐 独立影视审查官与剧本医生已完成全景交叉质检！\n` +
    `终审门禁：${gateBadge} (综合评分: ${finalReport.scores.overallScore}/100)\n` +
    `分项评分：因果逻辑 ${finalReport.scores.narrativeLogicScore} | 角色动机 ${finalReport.scores.characterDepthScore} | 分支张力 ${finalReport.scores.branchTensionScore} | 视听可行性 ${finalReport.scores.visualFeasibilityScore}\n` +
    `质检结论：${flawsText}。\n终审评语：${finalReport.verdict}`;

  return {
    finalReport,
    gateBadge,
    flawsText,
    summary,
  };
}
