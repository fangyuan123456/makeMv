/**
 * agents/reviewer/types.ts
 * 独立影视审查官与剧本医生智能体核心契约 (Critic Reviewer Types SSOT)
 */

export type ReviewGateStatus = 'PASS' | 'WARN' | 'FAIL' | 'STALE';

export interface ReviewScoreCard {
  narrativeLogicScore: number; // 剧情因果逻辑严密性与反机械降神 (0-100)
  characterDepthScore: number; // 角色立体度、动机可信度与反降智 (0-100)
  branchTensionScore: number; // 互动分支两难困境与反虚假选择 (0-100)
  visualFeasibilityScore: number; // 视听可拍性与 AI 生成落地边界 (0-100)
  overallScore: number; // 综合加权总分 (0-100)
}

export interface ReviewIssue {
  id?: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  dimension: 'LOGIC' | 'CHARACTER' | 'INTERACTIVE' | 'VISUAL';
  location: string; // 精准定位（如：第2幕第3场 / 选项 choice_b / 主角李默）
  description: string; // 缺陷详细剖析与因果断裂分析
  suggestion: string; // 资深审读官出具的剧本医生级精准自愈方案
}

export interface ReviewReport {
  projectName: string;
  stageReviewed: string;
  gateStatus: ReviewGateStatus; // 门禁决策 (PASS / WARN / FAIL / STALE)
  scores: ReviewScoreCard;
  thoughtChain: string; // 审查官批判推演思维链
  crossStageInsights?: {
    characterConsistency: string; // 角色跨场次人设/物种一致性洞察
    branchValidity: string; // 互动分支有效性洞察
    visualFeasibility: string; // 视听落地可行性洞察
  };
  criticalFlaws: ReviewIssue[];
  polishSuggestions: string[];
  verdict: string; // 终审一句话评语
  reviewedAt: string;
  isStale?: boolean; // 🌟 是否已因产物重新生成而失效
  staleReason?: string; // 🌟 失效原因说明
}

export interface CriticReviewParams {
  targetStage?: string;
  userFeedback?: string;
}

export interface ReviewInput {
  projectId: string;
  targetStage?: string;
  userConstraints?: string[];
  userFeedback?: string;
  abortSignal?: AbortSignal;
}

export interface CriticDialogInput {
  projectId: string;
  sessionId?: string;
  userMessage: string;
  targetStage?: string;
  currentReport?: ReviewReport;
  abortSignal?: AbortSignal;
}

export interface CriticDialogReply {
  reply: string;
  isDefenseAccepted: boolean;
  reassessedGateStatus?: ReviewGateStatus;
  adjustedFlaws?: Array<{
    location: string;
    severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
    description: string;
    suggestion: string;
  }>;
}
