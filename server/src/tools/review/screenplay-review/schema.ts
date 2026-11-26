/**
 * tools/review/screenplay-review/schema.ts
 * 剧本质量审查专属输出契约
 */

import { z } from 'zod';
import { ReviewIssueSchema } from '../shared/schema.js';

export const ScreenplayReviewReportSchema = z.object({
  passed: z.boolean().describe('剧本是否整体合格且无阻塞下游 AI 视频生成或破坏互动拓扑的硬伤'),
  summary: z.string().describe('100字以内总体评价摘要'),
  issues: z
    .array(ReviewIssueSchema)
    .describe('具体问题清单；仅记录真正影响 AI 视频生成或违反互动拓扑的实质性问题，没有则返回空数组'),
});

export type ScreenplayReviewReport = z.infer<typeof ScreenplayReviewReportSchema>;
