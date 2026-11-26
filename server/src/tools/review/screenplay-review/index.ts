/**
 * tools/review/screenplay-review/index.ts
 * 剧本质量审查执行器 (Screenplay Reviewer Runner SSOT)
 */

import { Agent } from '@mastra/core/agent';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { LLMProvider } from '../../../llm/index.js';
import { generateStructured } from '../../../utils/llm-diagnostics.js';
import {
  computeReviewArtifactHash,
  markReviewRunning,
  saveReviewResult,
  markReviewFailed,
  getReviewWithFreshness,
} from '../shared/review-store.js';
import type { ReviewFreshnessView } from '../shared/schema.js';
import { ScreenplayReviewReportSchema } from './schema.js';
import {
  buildScreenplayReviewerSystemPrompt,
  buildScreenplayReviewerUserPrompt,
} from './prompt.js';

export const SCREENPLAY_REVIEW_KEY = 'screenplay';

const inflightReviews = new Map<string, Promise<ReviewFreshnessView>>();

export async function runScreenplayReview(
  projectId: string,
  screenplayOverride?: string
): Promise<ReviewFreshnessView> {
  const store = ProjectStore.getInstance();
  const content = (
    screenplayOverride ??
    store.getArtifact<string>(projectId, 'screenplay') ??
    ''
  ).trim();

  if (!content) {
    throw new Error('当前项目暂无剧本正文，无法执行审查');
  }

  const targetHash = computeReviewArtifactHash(content);
  const dedupeKey = `${projectId}:${targetHash}`;
  const existingTask = inflightReviews.get(dedupeKey);
  if (existingTask) {
    return existingTask;
  }

  const task = (async (): Promise<ReviewFreshnessView> => {
    markReviewRunning(projectId, SCREENPLAY_REVIEW_KEY, content);
    try {
      const agent = new Agent({
        name: 'screenplay-reviewer-agent',
        instructions: buildScreenplayReviewerSystemPrompt(),
        model: LLMProvider.getModel(),
      });

      const report = await generateStructured({
        agent,
        prompt: buildScreenplayReviewerUserPrompt(content),
        schema: ScreenplayReviewReportSchema,
        stage: 'planner-review',
        step: 'screenplay-review',
        label: '剧本质量审查',
      });

      // 确定性收敛：只要不存在 error 级致命硬伤即视为达标通过（warning 仅作优化建议提示）
      report.passed = !report.issues.some((issue) => issue.severity === 'error');

      saveReviewResult(projectId, SCREENPLAY_REVIEW_KEY, targetHash, content, report);
      console.log(
        `[ScreenplayReview] 项目 ${projectId} 审查完成 | passed=${report.passed} | issues=${report.issues.length}`
      );
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error(`[ScreenplayReview] 项目 ${projectId} 审查异常:`, message);
      markReviewFailed(projectId, SCREENPLAY_REVIEW_KEY, targetHash, content, message);
    } finally {
      inflightReviews.delete(dedupeKey);
    }

    const latestContent = (store.getArtifact<string>(projectId, 'screenplay') ?? content).trim();
    return getReviewWithFreshness(projectId, SCREENPLAY_REVIEW_KEY, latestContent);
  })();

  inflightReviews.set(dedupeKey, task);
  return task;
}

/**
 * 非阻塞后台触发剧本审查 (Fire-and-forget)
 * 绝不阻塞主流程交付，异常内部消化并写入审查失败状态
 */
export function triggerScreenplayReviewAsync(
  projectId: string,
  screenplayOverride?: string
): void {
  void runScreenplayReview(projectId, screenplayOverride).catch((err) => {
    console.error(`[ScreenplayReview] 异步触发失败 (${projectId}):`, err);
  });
}
