/**
 * agents/director/workflows/register.ts
 * 总导演业务工序与状态机动态注册器 (Director Workflow Registration IoC SSOT)
 * 
 * 核心设计：
 * 1. 控制反转 (IoC)：影视 8 大工序阶段流转、质检门禁阻断与时空回退逻辑由本业务模块声明式注入；
 * 2. 彻底解耦通用底座：通用底座 WorkflowEngine 保持纯粹，不逆向硬编码任何总导演业务；
 * 3. 严格遵循法典：人在回路、审查官门禁 FAIL 刚性拦截、自愈放行、时空回溯源头治理。
 */

import { WorkflowEngine, type WorkflowHookContext } from '../../../workflow-engine/index.js';
import {
  storyBibleStep,
  characterPortraitStep,
  sceneScriptStep,
  storyboardStep,
  keyframeReferenceStep,
  videoProductionStep,
  criticReviewStep,
  fmvPackagingStep,
} from './steps/stage-steps.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { WorkflowStage, SessionStatus, STAGE_SEQUENCE } from '../../../types/index.js';

/**
 * 8 大视听工序标准 Step 微内核映射表 (Stage Steps SSOT)
 */
export const STAGE_STEPS: Record<string, any> = {
  'story-bible': storyBibleStep,
  'character-portrait': characterPortraitStep,
  'scene-script': sceneScriptStep,
  'storyboard': storyboardStep,
  'keyframe-reference': keyframeReferenceStep,
  'video-production': videoProductionStep,
  'critic-review': criticReviewStep,
  'fmv-packaging': fmvPackagingStep,
};

/**
 * 影视生产各工序到下一阶段的权威推进映射表 (Stage Transition Map SSOT)
 */
export const STAGE_TRANSITION_MAP: Record<string, WorkflowStage> = {
  'story-bible': WorkflowStage.CHARACTER_DESIGN,
  'character-portrait': WorkflowStage.SCENE_SCRIPT,
  'scene-script': WorkflowStage.STORYBOARD,
  'storyboard': WorkflowStage.KEYFRAME_REFERENCE,
  'keyframe-reference': WorkflowStage.VIDEO_PRODUCTION,
  'video-production': WorkflowStage.FMV_PACKAGING,
  'fmv-packaging': WorkflowStage.COMPLETED,
};

/**
 * 各技能所属的法定工序阶段单一事实来源 (Skill to Stage SSOT)
 */
export const STAGE_OF_SKILL: Record<string, WorkflowStage> = {
  'story-bible': WorkflowStage.NARRATIVE_DESIGN,
  'character-portrait': WorkflowStage.CHARACTER_DESIGN,
  'scene-script': WorkflowStage.SCENE_SCRIPT,
  'storyboard': WorkflowStage.STORYBOARD,
  'keyframe-reference': WorkflowStage.KEYFRAME_REFERENCE,
  'video-production': WorkflowStage.VIDEO_PRODUCTION,
  'fmv-packaging': WorkflowStage.FMV_PACKAGING,
};

export const SKILL_TITLES: Record<string, string> = {
  'story-bible': '生成故事圣经 (Story Bible)',
  'character-portrait': '生成角色定妆照 (Character Portrait)',
  'scene-script': '生成分场剧本 (Scene Script)',
  'storyboard': '生成分镜脚本 (Storyboard)',
  'keyframe-reference': '生成关键帧图 (Keyframe Reference)',
  'video-production': '生成动态视频 (Video Production)',
  'critic-review': '审查官多维质检评估 (Critic Review)',
  'fmv-packaging': '互动影游封装总装 (FMV Packaging)',
};

/**
 * 审查官刚性门禁校验钩子 (FAIL 跨工序阻断与自愈放行闭环)
 */
function createDirectorGateValidator(skillKey: string) {
  return (ctx: WorkflowHookContext): { pass: boolean; reason?: string } => {
    const projectStore = ProjectStore.getInstance();
    const project = projectStore.getProject(ctx.projectId);
    if (!project) return { pass: true };

    const stageGate = projectStore.getArtifact<{ gateStatus?: string }>(
      ctx.projectId,
      `critic_review_${project.currentStage}`
    );

    const skillStage = STAGE_OF_SKILL[skillKey];
    const targetOrder = STAGE_SEQUENCE.indexOf(skillStage as WorkflowStage);
    const currentOrder = STAGE_SEQUENCE.indexOf(project.currentStage);
    const isRollback =
      ctx.actionType === 'STAGE_ROLLBACK' ||
      ctx.payload?.actionType === 'STAGE_ROLLBACK' ||
      ctx.payload?.isRollback === true ||
      (targetOrder >= 0 && currentOrder >= 0 && targetOrder < currentOrder);

    // 判定是否属于自愈或同阶段工序：
    // 1. 审查工序本身放行（用于复审）
    // 2. actionType 为 TARGETED_REVISE（微调自愈修补，允许执行）
    // 3. 时空回退工序放行（源头治理，允许往上游回退）
    // 4. 技能法定阶段等于当前阶段（同阶段重试）
    const isSelfHealing =
      skillKey === 'critic-review' ||
      ctx.actionType === 'TARGETED_REVISE' ||
      ctx.payload?.actionType === 'TARGETED_REVISE' ||
      isRollback ||
      (Boolean(skillStage) && skillStage === project.currentStage);

    if (stageGate?.gateStatus === 'FAIL' && !isSelfHealing) {
      return {
        pass: false,
        reason: `当前阶段 ${project.currentStage} 审查未通过 (FAIL)，禁止跨工序推进执行 ${skillKey}！请先优化当前阶段。`,
      };
    }

    return { pass: true };
  };
}

/**
 * 影视阶段状态机推进与时空回退成功钩子
 */
function createDirectorSuccessHandler(skillKey: string) {
  return async (ctx: WorkflowHookContext): Promise<void> => {
    const projectStore = ProjectStore.getInstance();
    const project = projectStore.getProject(ctx.projectId);
    if (!project) return;

    const isCriticSkill = skillKey === 'critic-review';
    const criticGate = ctx.result?.criticGateStatus || ctx.result?.report?.gateStatus;

    const isTargetedRevise = ctx.actionType === 'TARGETED_REVISE' || ctx.payload?.actionType === 'TARGETED_REVISE';
    const skillStage = STAGE_OF_SKILL[skillKey];
    const targetOrder = STAGE_SEQUENCE.indexOf(skillStage as WorkflowStage);
    const currentOrder = STAGE_SEQUENCE.indexOf(project.currentStage);
    const isRollback =
      ctx.actionType === 'STAGE_ROLLBACK' ||
      ctx.payload?.actionType === 'STAGE_ROLLBACK' ||
      ctx.payload?.isRollback === true ||
      (targetOrder >= 0 && currentOrder >= 0 && targetOrder < currentOrder);

    if (!isCriticSkill && criticGate !== 'FAIL') {
      if (isRollback && skillStage) {
        // 【时空回退与因果链路重修】：安全回退项目阶段
        project.currentStage = skillStage;
        project.updatedAt = new Date().toISOString();

        // 下游受影响阶段的审查官旧门禁与视听资产失效自愈：级联清除下游阶段的已过时报告与资产
        for (let i = targetOrder + 1; i < STAGE_SEQUENCE.length; i++) {
          const downstreamStage = STAGE_SEQUENCE[i];
          try {
            projectStore.setArtifact(ctx.projectId, `critic_review_${downstreamStage}`, null);
            projectStore.setArtifact(ctx.projectId, downstreamStage, null);
          } catch {}
          if (project.stageArtifacts && project.stageArtifacts[downstreamStage]) {
            delete project.stageArtifacts[downstreamStage];
          }
        }
        projectStore.saveProject(project);
        console.log(`[WorkflowEngine] 项目 [${ctx.projectId}] 成功执行时空回退至工序阶段: ${skillStage}，已级联清理所有下游过时资产`);
      } else if (!isTargetedRevise) {
        if (!skillStage || skillStage === project.currentStage) {
          const nextStage = STAGE_TRANSITION_MAP[skillKey];
          if (nextStage) {
            project.currentStage = nextStage;
            if (nextStage === WorkflowStage.COMPLETED) {
              project.status = SessionStatus.COMPLETED;
            }
            project.updatedAt = new Date().toISOString();
            projectStore.saveProject(project);
            console.log(`[WorkflowEngine] 项目 [${ctx.projectId}] 成功推进阶段至: ${nextStage}`);
          }
        } else {
          console.log(`[WorkflowEngine] 工序 [${skillKey}] 所属阶段 [${skillStage}] 非当前阶段 [${project.currentStage}]，保持阶段不变`);
        }
      }
    }
  };
}

/**
 * 向微内核通用工作流引擎注册总导演全量 8 大工序原子 Step
 */
export function registerDirectorWorkflows(): void {
  const engine = WorkflowEngine.getInstance();
  for (const [key, step] of Object.entries(STAGE_STEPS)) {
    engine.registerWorkflow({
      key,
      execute: step,
      title: SKILL_TITLES[key] || `执行工序: ${key}`,
      legalStage: STAGE_OF_SKILL[key],
      nextStage: STAGE_TRANSITION_MAP[key],
      validateGate: createDirectorGateValidator(key),
      onSuccess: createDirectorSuccessHandler(key),
    });
  }
}
