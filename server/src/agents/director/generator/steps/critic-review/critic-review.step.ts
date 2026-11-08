/**
 * agents/pipeline/workflows/steps/critic-review/critic-review.step.ts
 * 影视工序第 7 阶段：独立质检审查 (Critic Review Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext, shouldSkipUnchangedStep } from '../common.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { stageCriticReportKey, CRITIC_ARCHIVE_KEY } from '../../../../../project-store/critic-report.js';
import type { WorkflowStage } from '../../../../../types/index.js';
import { LLMRegistry } from '../../../../../llm/LLMRegistry.js';
import { buildPanoramicAuditPrompt, CRITIC_REVIEWER_SYSTEM_PROMPT } from './prompt.js';
import { evaluateCriticAudit } from './evaluator.js';
import { CriticAuditReportSchema, type CriticAuditReportOutput } from './schema.js';

export async function executeCriticReview(context: WorkflowContext): Promise<WorkflowContext> {
  const { projectId, activeStage, feedback, payload, overrideParams } = context;
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId);

  // 先定被审查阶段。过去末位兜底硬编码 'storyboard'，猜错时报告会写进
  // critic_review_storyboard，而门禁读的是 critic_review_${currentStage}，
  // 全靠读取侧的总报告回落兜着才没出事。现在拿不到就明确失败，绝不猜。
  const targetStage: string | undefined =
    payload?.stage ||
    payload?.targetStage ||
    overrideParams?.stage ||
    overrideParams?.targetStage ||
    activeStage ||
    project?.currentStage;

  if (!targetStage) {
    throw new Error(
      `[CriticReview] 项目 [${projectId}] 无法确定被审查阶段：` +
        'payload/overrideParams/activeStage/currentStage 均为空，拒绝猜测默认阶段写入报告'
    );
  }

  // 1. 检查是否跳过：用真实阶段判时空超前，用阶段报告键查既有资产
  const skipCheck = shouldSkipUnchangedStep(
    projectId,
    targetStage as WorkflowStage,
    'criticReviewStep',
    context,
    stageCriticReportKey(targetStage)
  );
  if (skipCheck.shouldSkip) {
    return {
      ...context,
      toolResult: skipCheck.existingArtifact,
      lastSummary: '独立审查：已跳过未变更工序并复用既有资产。',
    };
  }

  // 2. 组装待质检工程资产与全景快照
  const snapshot = store.getSnapshot(projectId);
  const panoramicAssets = snapshot?.project?.stageArtifacts || {};
  const projectName = project?.title || '未命名互动影游';

  const prompt = buildPanoramicAuditPrompt(
    projectName,
    targetStage,
    panoramicAssets,
    project?.meta?.userConstraints,
    feedback
  );

  const llm = LLMRegistry.get();
  const rawAudit = await llm.generateObject<CriticAuditReportOutput>(
    prompt,
    CriticAuditReportSchema,
    CRITIC_REVIEWER_SYSTEM_PROMPT,
    {
      stage: 'critic_review',
      projectId,
      temperature: 0.2,
    }
  );

  // 3. 规范化裁决
  const evaluated = evaluateCriticAudit({
    rawReport: rawAudit,
    projectName,
    activeStage: targetStage,
  });

  // 4. 写入黑板：阶段报告是唯一门禁真相；总报告只是不区分阶段的历史归档副本，
  //    保留写入是因为既有消费方依赖它，但读取判定一律走 critic-report.ts，
  //    绝不把归档当成当前阶段的门禁结论。
  store.setArtifact(projectId, CRITIC_ARCHIVE_KEY, evaluated.finalReport);
  store.setArtifact(projectId, stageCriticReportKey(targetStage), evaluated.finalReport);

  return {
    ...context,
    criticGateStatus: evaluated.finalReport.gateStatus,
    toolResult: evaluated.finalReport,
    lastSummary: evaluated.summary,
  };
}

export const criticReviewStep = createStep({
  id: 'critic-review-step',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    return await executeCriticReview(inputData);
  },
});
