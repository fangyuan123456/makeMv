/**
 * agents/pipeline/workflows/steps/common.ts
 * 影视工序步骤通用上下文契约与缓存复用判断 (Step Common Utilities SSOT)
 */

import { z } from 'zod';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { WorkflowStage, STAGE_SEQUENCE } from '../../../../types/index.js';

// 通用工作流数据载体 Schema
export const WorkflowContextSchema = z.object({
  projectId: z.string(),
  sessionId: z.string().optional(),
  activeStage: z.string().optional(),
  feedback: z.string().optional(),
  payload: z.record(z.any()).optional(),
  overrideParams: z.record(z.any()).optional(),
  criticGateStatus: z.string().optional(),
  lastSummary: z.string().optional(),
  toolResult: z.any().optional(),
});

export type WorkflowContext = z.infer<typeof WorkflowContextSchema>;

/**
 * 辅助函数：根据受影响工序清单与当前业务阶段判定当前工序是否可以安全跳过并复用既有资产
 *
 * artifactKey 把「用哪个阶段判时空超前」与「用哪个键查既有资产」解耦：
 * 绝大多数工序两者相同；审查工序的资产键是 `critic_review_${stage}`，
 * 过去靠 `as any` 把 'criticReports' 当 stage 传，既绕开类型，
 * 又让 STAGE_SEQUENCE.indexOf 恒为 -1、时空超前门禁静默失效。
 */
export function shouldSkipUnchangedStep(
  projectId: string,
  stage: WorkflowStage,
  stepKey: string,
  inputData: any,
  artifactKey?: string
): { shouldSkip: boolean; existingArtifact?: any; reason?: string } {
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId);
  const existingArtifact = store.getArtifact(projectId, artifactKey ?? stage) as any;

  const normalizeKey = (k?: string) =>
    (k || '').replace(/Step$/, '').replace(/[-_]/g, '').toLowerCase();

  // 1. 🌟 时空超前刚性门禁：若目标工序所属阶段超前于当前项目推进阶段 (currentStage)，尚未解锁到达，必须刚性 return 跳过！
  const isDirectTarget =
    Boolean(inputData?.targetSkill && normalizeKey(inputData.targetSkill) === normalizeKey(stepKey)) ||
    Boolean(inputData?.payload?.targetSkill && normalizeKey(inputData.payload.targetSkill) === normalizeKey(stepKey)) ||
    Boolean(inputData?.overrideParams?.targetSkill && normalizeKey(inputData.overrideParams.targetSkill) === normalizeKey(stepKey)) ||
    Boolean(inputData?.payload?.skill && normalizeKey(inputData.payload.skill) === normalizeKey(stepKey)) ||
    inputData?.targetSkill === stepKey ||
    inputData?.payload?.targetSkill === stepKey ||
    inputData?.overrideParams?.targetSkill === stepKey ||
    inputData?.payload?.skill === stepKey;

  if (!isDirectTarget && project?.currentStage) {
    const targetOrder = STAGE_SEQUENCE.indexOf(stage);
    const currentOrder = STAGE_SEQUENCE.indexOf(project.currentStage as WorkflowStage);
    if (targetOrder >= 0 && currentOrder >= 0 && targetOrder > currentOrder) {
      return {
        shouldSkip: true,
        existingArtifact,
        reason: `工序 [${stepKey}] 所属阶段 [${stage}] 超前于项目当前阶段 [${project.currentStage}]，尚未到达解锁，直接安全返回跳过`,
      };
    }
  }

  // 2. 🌟 资产复用门禁：若已有产物且未受本次修改波及，毫秒级复用既有资产
  if (!existingArtifact) {
    return { shouldSkip: false };
  }

  // 提取受影响清单 affectedSteps
  const affectedSteps: string[] =
    inputData.payload?.affectedSteps ||
    inputData.overrideParams?.affectedSteps ||
    [];

  // 只有当受影响清单已提供（且明确不包含本工序 stepKey）时，毫秒级复用既有资产
  if (
    Array.isArray(affectedSteps) &&
    affectedSteps.length > 0 &&
    !affectedSteps.some((s) => normalizeKey(s) === normalizeKey(stepKey))
  ) {
    return {
      shouldSkip: true,
      existingArtifact,
      reason: `工序 [${stepKey}] 未在受影响清单中 (affectedSteps: ${affectedSteps.join(', ')})，100% 毫秒级复用既有资产`,
    };
  }

  return { shouldSkip: false, existingArtifact };
}
