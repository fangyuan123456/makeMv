/**
 * tools/review/shared/schema.ts
 * 全流程质量审核通用契约 (Universal Review Schema SSOT)
 */

import { z } from 'zod';

export const ReviewSeveritySchema = z.enum(['error', 'warning']);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const ReviewIssueSchema = z.object({
  id: z.string().describe('问题唯一标识，如 issue_1'),
  severity: ReviewSeveritySchema.describe('严重程度：error 表示会阻塞下游或破坏生成，warning 表示建议优化'),
  category: z.string().describe('问题所属维度标签'),
  actNumber: z.number().int().positive().optional().describe('所属幕次（若定位到具体分幕）'),
  excerpt: z.string().describe('原文中存在问题的具体片段摘录'),
  reason: z.string().describe('违背规范的具体原因说明'),
  fixInstruction: z.string().describe('可直接交给局部修改工具执行的精准外科手术修复指令'),
});
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

export const ReviewReportSchema = z.object({
  passed: z.boolean().describe('是否完全通过审查（无任何 error 级别问题且整体合格）'),
  summary: z.string().describe('一句话总体审查结论'),
  issues: z.array(ReviewIssueSchema).describe('发现的问题清单；若完全通过则为空数组'),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

export type ReviewArchiveStatus = 'idle' | 'reviewing' | 'passed' | 'issues_found' | 'failed';

export interface ReviewArchiveRecord {
  targetType: 'screenplay' | string;
  artifactHash: string;
  artifactSnapshot: string;
  status: Exclude<ReviewArchiveStatus, 'idle'>;
  reviewedAt: number;
  error?: string;
  report?: ReviewReport;
}

export interface ReviewFreshnessView {
  targetType: string;
  status: ReviewArchiveStatus;
  isStale: boolean;
  currentHash: string;
  artifactHash?: string;
  artifactSnapshot?: string;
  reviewedAt?: number;
  error?: string;
  report?: ReviewReport;
}
