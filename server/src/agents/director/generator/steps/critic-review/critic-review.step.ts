/**
 * agents/pipeline/workflows/steps/critic-review/critic-review.step.ts
 * 影视工序第 7 阶段：独立质检审查 (Critic Review Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext, shouldSkipUnchangedStep } from '../common.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../../../../llm/LLMRegistry.js';
import { buildPanoramicAuditPrompt, CRITIC_REVIEWER_SYSTEM_PROMPT } from './prompt.js';
import { evaluateCriticAudit } from './evaluator.js';
import { CriticAuditReportSchema, type CriticAuditReportOutput } from './schema.js';

export async function executeCriticReview(context: WorkflowContext): Promise<WorkflowContext> {
  const { projectId, activeStage, feedback, payload, overrideParams } = context;
  const store = ProjectStore.getInstance();

  // 1. 检查是否跳过
  const skipCheck = shouldSkipUnchangedStep(projectId, 'criticReports' as any, 'criticReviewStep', context);
  if (skipCheck.shouldSkip) {
    return {
      ...context,
      toolResult: skipCheck.existingArtifact,
      lastSummary: '独立审查：已跳过未变更工序并复用既有资产。',
    };
  }

  // 2. 组装待质检工程资产与全景快照
  const project = store.getProject(projectId);
  const targetStage =
    payload?.stage ||
    payload?.targetStage ||
    overrideParams?.stage ||
    overrideParams?.targetStage ||
    activeStage ||
    project?.currentStage ||
    'storyboard';
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

  // 4. 写入黑板 (同时归档总报告与阶段隔离审查报告)
  store.setArtifact(projectId, 'criticReports', evaluated.finalReport);
  store.setArtifact(projectId, `critic_review_${targetStage}`, evaluated.finalReport);

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
