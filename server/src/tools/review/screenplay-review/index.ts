/**
 * tools/review/screenplay-review/index.ts
 * 剧本质量审查执行器 (Screenplay Reviewer Runner SSOT)
 */

import { Agent } from '@mastra/core/agent';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { renderScreenplayMarkdownFromDocument } from '../../../project-store/story-source.js';
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

/**
 * 代码级过滤审查官误报：拦截任何企图制造假合流或让最后一幕推进主线的错误指令
 */
function filterContradictoryReviewIssues<T extends { description?: string; fixInstruction?: string; severity?: string; location?: string }>(
  issues: T[],
  scriptMarkdown: string
): T[] {
  const actMatches = Array.from(scriptMarkdown.matchAll(/^##\s*第\s*(\d+)\s*幕/gm));
  const maxActNum = actMatches.reduce((max, m) => Math.max(max, Number(m[1]) || 0), 0);

  return issues.filter((issue) => {
    const desc = issue.description || '';
    const fix = issue.fixInstruction || '';
    const loc = issue.location || '';
    const combined = `${desc} ${fix}`;

    // 1. 严禁要求把原本走向终局/非主线的选项（如 B / TIMEOUT）改为推进主线（会制造假合流）
    if (
      /将.*?(选项\s*[A-Z]|超时|TIMEOUT).*?(改为|改成|修改为).*?推进主线/i.test(fix) ||
      /选项\s*[A-Z].*?和.*?超时.*?改为推进主线/i.test(fix)
    ) {
      return false;
    }

    // 2. 严禁要求最后一幕出现“推进主线”
    if (
      maxActNum > 0 &&
      (loc.includes(`第 ${maxActNum} 幕`) || loc.includes(`第${maxActNum}幕`)) &&
      /改为推进主线|增加.*?推进主线|设为推进主线/i.test(fix)
    ) {
      return false;
    }

    // 3. 豁免“互动钩子简要说明与下方终局正文并存”的误报
    if (/【互动钩子】.*【终局】.*重复|与.*【终局】.*重复/i.test(combined)) {
      return false;
    }

    return true;
  });
}

export async function runScreenplayReview(
  projectId: string,
  screenplayOverride?: string
): Promise<ReviewFreshnessView> {
  const store = ProjectStore.getInstance();
  const screenplayJson = store.getArtifact<any>(projectId, 'screenplay_json');
  const content = (
    screenplayOverride ??
    (screenplayJson ? renderScreenplayMarkdownFromDocument(screenplayJson) : '')
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

      // 代码级过滤误报并确定性收敛：只要不存在 error 级致命硬伤即视为达标通过
      report.issues = filterContradictoryReviewIssues(report.issues || [], content);
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
