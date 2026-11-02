/**
 * agents/reviewer/schema.ts
 * 独立影视审查官与剧本医生 Zod 契约规约 (Critic Reviewer Zod SSOT)
 */

import { z } from 'zod';

// 1. 多维评分卡 Schema
export const ReviewScoresSchema = z.object({
  narrativeLogicScore: z.number().min(0).max(100).describe('剧情因果逻辑严密性与反机械降神 (0-100)'),
  characterDepthScore: z.number().min(0).max(100).describe('角色立体度、动机可信度与反降智 (0-100)'),
  branchTensionScore: z.number().min(0).max(100).describe('互动分支两难困境与反虚假选择 (0-100)'),
  visualFeasibilityScore: z.number().min(0).max(100).describe('视听可拍性与 AI 生成落地边界 (0-100)'),
  overallScore: z.number().min(0).max(100).describe('综合加权总评打分 (0-100)'),
});

// 2. 跨阶段全景洞察 Schema
export const CrossStageInsightsSchema = z.object({
  characterConsistency: z.string().describe('角色跨场次人设、心理动机与物种一致性洞察'),
  branchValidity: z.string().describe('互动分支是否为真选择、戏剧代价差异洞察'),
  visualFeasibility: z.string().describe('提示词视听画面可拍性与落地 feasibility 洞察'),
});

// 3. 致命/严重漏洞条目 Schema
export const CriticalFlawItemSchema = z.object({
  severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR']).describe('瑕疵严重等级'),
  dimension: z.enum(['LOGIC', 'CHARACTER', 'INTERACTIVE', 'VISUAL']).describe('审查维度'),
  location: z.string().describe('缺陷精准定位（如：第2幕第3场 / 选项 choice_1 / 主角李默）'),
  description: z.string().describe('漏洞详细剖析与因果断裂分析'),
  suggestion: z.string().describe('资深剧本医生出具的自愈修改建议'),
});

// 4. 审查官终审报告推演 Schema (面向大模型 generateObject 输出契约)
export const CriticAuditReportSchema = z.object({
  projectName: z.string().optional().describe('项目名称'),
  stageReviewed: z.string().optional().describe('被审计的工序阶段标识'),
  thoughtChain: z.string().describe('审查官批判推演思维链：详尽阐述因果断裂与破绽推演过程'),
  crossStageInsights: CrossStageInsightsSchema.describe('跨工序全景交叉洞察'),
  gateStatus: z.enum(['PASS', 'WARN', 'FAIL']).describe('门禁裁决状态'),
  scores: ReviewScoresSchema.describe('多维工业量化评分'),
  criticalFlaws: z.array(CriticalFlawItemSchema).describe('致命与关键漏洞清单'),
  polishSuggestions: z.array(z.string()).describe('好莱坞剧本医生级别自愈优化建议列表'),
  verdict: z.string().describe('终审一句话定性评语'),
});

export type CriticAuditReportOutput = z.infer<typeof CriticAuditReportSchema>;

// 5. 创作者对辩质询回应 Schema (面向 chat 对辩大模型 generateObject 输出契约)
export const CriticDialogAdjustedFlawSchema = z.object({
  location: z.string().describe('漏洞发生位置'),
  severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR']).describe('调整后的严重级别'),
  dimension: z.enum(['LOGIC', 'CHARACTER', 'INTERACTIVE', 'VISUAL']).optional().default('LOGIC').describe('审查维度'),
  description: z.string().describe('漏洞最新评定描述'),
  suggestion: z.string().optional().default('').describe('自愈建议'),
});

export const CriticDialogReplySchema = z.object({
  reply: z.string().describe('审阅官针对创作者辩护的犀利专业答复，剖析其戏剧自洽性'),
  isDefenseAccepted: z.boolean().describe('创作者的解释是否符合戏剧因果律从而被审查官采纳'),
  reassessedGateStatus: z.enum(['PASS', 'WARN', 'FAIL']).optional().describe('复核评估后的门禁放行决策'),
  adjustedFlaws: z.array(CriticDialogAdjustedFlawSchema).optional().describe('经对辩后调整或降级的漏洞列表'),
});

export type CriticDialogReplyOutput = z.infer<typeof CriticDialogReplySchema>;
