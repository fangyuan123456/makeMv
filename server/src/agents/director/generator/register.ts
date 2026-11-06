/**
 * agents/pipeline/workflows/register.ts
 * 影视业务工序与状态机动态注册器 (Workflow Registration IoC SSOT)
 * 
 * 核心设计：
 * 1. 控制反转 (IoC)：影视 8 大工序阶段流转、质检门禁阻断与时空回退逻辑由本业务模块声明式注入；
 * 2. 彻底解耦通用底座：通用底座 WorkflowEngine 保持纯粹，不逆向硬编码任何特定业务；
 * 3. 严格遵循法典：人在回路、审查官门禁 FAIL 刚性拦截、自愈放行、时空回溯源头治理。
 */

import { Workflow, type WorkflowHookContext } from '../../../workflow-engine/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../../llm/LLMRegistry.js';
import { WorkflowStage, SessionStatus, STAGE_SEQUENCE, type ActionProposal } from '../../../types/index.js';
import {
  STEP_MANIFESTS,
  getStepManifest,
  STAGE_TRANSITION_MAP,
  STAGE_OF_SKILL,
  SKILL_OF_STAGE,
  SKILL_TITLES,
} from './constants.js';
import {
  storyBibleSubWorkflow,
  characterPortraitSubWorkflow,
  sceneScriptSubWorkflow,
  storyboardSubWorkflow,
  keyframeReferenceSubWorkflow,
  videoProductionSubWorkflow,
} from './steps/index.js';

export {
  STEP_MANIFESTS,
  getStepManifest,
  STAGE_TRANSITION_MAP,
  STAGE_OF_SKILL,
  SKILL_OF_STAGE,
  SKILL_TITLES,
} from './constants.js';

/**
 * 8 大视听工序标准 Step 微内核映射表获取函数 (从 Manifests 动态派生)
 */
export function getStageSteps(): Record<string, any> {
  const steps: Record<string, any> = {};
  for (const m of STEP_MANIFESTS) {
    steps[m.key] = m.step;
  }
  return steps;
}

export const STAGE_STEPS: Record<string, any> = new Proxy({} as any, {
  get: (_, prop: string) => getStageSteps()[prop],
  ownKeys: () => Object.keys(getStageSteps()),
  getOwnPropertyDescriptor: (_, prop) => ({
    enumerable: true,
    configurable: true,
    value: getStageSteps()[prop as string],
  }),
});

/**
 * 审查官刚性门禁校验钩子 (FAIL 跨工序阻断与自愈放行闭环)
 */
function createPipelineGateValidator(skillKey: string) {
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
function createPipelineSuccessHandler(skillKey: string) {
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
      (ctx.actionType === 'STAGE_ROLLBACK' ||
       ctx.payload?.actionType === 'STAGE_ROLLBACK' ||
       ctx.payload?.isRollback === true ||
       (targetOrder >= 0 && currentOrder >= 0 && targetOrder < currentOrder)) &&
      !isTargetedRevise;

    if (!isCriticSkill && criticGate !== 'FAIL') {
      if (isRollback && skillStage) {
        // 【时空回退与因果链路重修】：安全回退项目阶段
        project.currentStage = skillStage;
        project.updatedAt = new Date().toISOString();

        // 下游受影响阶段的审查官旧门禁与视听资产失效自愈：级联清除下游阶段的已过时报告与资产
        for (let i = targetOrder + 1; i < STAGE_SEQUENCE.length; i++) {
          const downstreamStage = STAGE_SEQUENCE[i];
          if (project.stageArtifacts) {
            delete project.stageArtifacts[downstreamStage];
            delete project.stageArtifacts[`critic_review_${downstreamStage}`];
          }
        }
        if (project.stageArtifacts && project.stageArtifacts['criticReports']) {
          delete project.stageArtifacts['criticReports'];
        }
        projectStore.saveProject(project);
        console.log(`[WorkflowEngine] 项目 [${ctx.projectId}] 成功执行时空回退至工序阶段: ${skillStage}，已级联清理所有下游过时资产`);
      } else if (isTargetedRevise) {
        // 【定向微调因果链路自愈】：上游微调成功后，级联清理所有下游过时资产与审查门禁，状态机对齐
        if (skillStage && targetOrder >= 0) {
          let cleanedDownstreamCount = 0;
          for (let i = targetOrder + 1; i < STAGE_SEQUENCE.length; i++) {
            const downstreamStage = STAGE_SEQUENCE[i];
            if (project.stageArtifacts) {
              if (project.stageArtifacts[downstreamStage]) {
                delete project.stageArtifacts[downstreamStage];
                cleanedDownstreamCount++;
              }
              if (project.stageArtifacts[`critic_review_${downstreamStage}`]) {
                delete project.stageArtifacts[`critic_review_${downstreamStage}`];
              }
            }
          }
          if (project.stageArtifacts && project.stageArtifacts['criticReports']) {
            delete project.stageArtifacts['criticReports'];
          }

          if (targetOrder < currentOrder) {
            project.currentStage = skillStage;
          }

          project.updatedAt = new Date().toISOString();
          projectStore.saveProject(project);
          console.log(`[WorkflowEngine] 项目 [${ctx.projectId}] 定向微调工序 [${skillKey}] 完成 (清理下游过时资产: ${cleanedDownstreamCount})`);
        }
      } else {
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

      // 判定是否有下一待执行工序，自动就绪 pending 推进提案（人在回路，无缝衔接）
      let nextSkillToPropose: string | undefined;
      if (!isRollback && project.currentStage && project.currentStage !== WorkflowStage.COMPLETED) {
        if (isTargetedRevise) {
          // 定向微调落盘后，当前阶段依然存在待推演工序时自动就绪
          const currentStageSkill = SKILL_OF_STAGE[project.currentStage];
          if (currentStageSkill) {
            nextSkillToPropose = currentStageSkill;
          }
        } else {
          // 顺向推进落盘后，就绪新阶段的合法工序
          const stageSkill = SKILL_OF_STAGE[project.currentStage];
          if (stageSkill) {
            nextSkillToPropose = stageSkill;
          }
        }
      }

      const title = SKILL_TITLES[skillKey] || skillKey;
      let nextProposal: ActionProposal | undefined;

      if (nextSkillToPropose) {
        const nextTitle = SKILL_TITLES[nextSkillToPropose] || nextSkillToPropose;
        try {
          const engine = Workflow.getInstance();
          const dispatchRes = await engine.dispatch({
            projectId: ctx.projectId,
            sessionId: ctx.sessionId,
            workflowKey: nextSkillToPropose,
            actionType: 'PROCEED_STAGE',
            title: `启动下一工序：${nextTitle}`,
            reason: `工序【${title}】已成功落盘，提议启动下一工序【${nextTitle}】`,
            requireConfirmation: true, // 100% 保持 pending，人在回路，等待创作者点击或打字授权
          });
          nextProposal = dispatchRes.proposal;
        } catch (err: any) {
          console.warn(`[WorkflowEngine] 自动就绪下一工序提案非致命提示:`, err.message);
        }
      }

      // 向当前会话写入系统工序执行落盘通知，保障多轮对话因果闭环，并挂载就绪提案卡片
      if (ctx.sessionId) {
        const actionText = isRollback ? '时空回退重做' : isTargetedRevise ? '定向微调' : '推演完成';
        const guideText = nextProposal
          ? `\n\n🎯 已为您就绪下一工序【${nextProposal.label}】。您可以直接点击下方卡片或右下角按钮启动，也可以在对话中提出调整。`
          : '。相关视听资产已入库，创作者可随时继续对话推进或提出调整。';

        projectStore.appendMessage(ctx.projectId, ctx.sessionId, {
          role: 'assistant',
          content: `🎬【系统工序通知】已成功执行并落盘【${title}】（${actionText}）${guideText}`,
          timestamp: new Date().toISOString(),
          proposal: nextProposal,
        } as any);
      }
    }
  };
}

/**
 * 包装工序执行器：支持标准流水线向前推演与定向增量修改（Dual-Track 纯洁架构）
 */
function createPipelineExecutor(skillKey: string, standardStep: any) {
  return async ({ inputData }: { inputData: any }) => {
    const isTargetedRevise =
      inputData.actionType === 'TARGETED_REVISE' ||
      inputData.payload?.actionType === 'TARGETED_REVISE';

    if (isTargetedRevise) {
      const userFeedback =
        inputData.payload?.userFeedback ||
        inputData.payload?.userPrompt ||
        inputData.feedback ||
        inputData.payload?.reason ||
        '';
      const projectId = inputData.projectId;
      const llm = LLMRegistry.get();
      const target =
        inputData.payload?.target ||
        inputData.target ||
        inputData.payload?.targetCharacterNames?.[0] ||
        inputData.payload?.targetShotId;
      const affectedSteps = inputData.payload?.affectedSteps || inputData.affectedSteps;
      const isMock = inputData.payload?.isMock ?? false;

      // 单一工序定向增量外科手术微调 (通过 StepManifest.modifier 统一委托，0 冗余 if-else 分支)
      const manifest = getStepManifest(skillKey);
      if (manifest?.modifier) {
        const modRes = await manifest.modifier({
          projectId,
          userFeedback,
          llm,
          target,
          payload: inputData.payload,
        });
        if (!modRes.success) {
          throw new Error(modRes.error || `${manifest.title} 增量修改失败`);
        }
        return {
          ...inputData,
          toolResult: modRes.data,
          lastSummary: modRes.summary || `${manifest.title} 已完成靶向修改并保存`,
        };
      }
    }

    // 默认顺向标准 Step 执行
    const executeFn = typeof standardStep === 'function' ? standardStep : standardStep.execute.bind(standardStep);
    return await executeFn({ inputData });
  };
}

/**
 * 向微内核通用工作流引擎注册全量 8 大工序原子 Step
 */
export function registerPipelineWorkflows(): void {
  const engine = Workflow.getInstance();
  const steps = getStageSteps();
  for (const [key, step] of Object.entries(steps)) {
    const manifest = getStepManifest(key);
    engine.registerWorkflow({
      key,
      execute: createPipelineExecutor(key, step),
      title: SKILL_TITLES[key] || `执行工序: ${key}`,
      legalStage: STAGE_OF_SKILL[key],
      nextStage: STAGE_TRANSITION_MAP[key],
      requireConfirmation: manifest?.requireConfirmation,
      validateGate: createPipelineGateValidator(key),
      onSuccess: createPipelineSuccessHandler(key),
    });
  }

  // 🌟 源头声明式注册微观子工作流 (Micro Sub-Workflows)，显式标记 requireConfirmation: false (全自动直通)
  engine.registerWorkflow({
    key: 'subwf-story-bible',
    execute: storyBibleSubWorkflow as any,
    title: '叙事架构微观子工作流',
    requireConfirmation: false,
  });
  engine.registerWorkflow({
    key: 'subwf-character-portrait',
    execute: characterPortraitSubWorkflow as any,
    title: '角色定妆微观子工作流',
    requireConfirmation: false,
  });
  engine.registerWorkflow({
    key: 'subwf-scene-script',
    execute: sceneScriptSubWorkflow as any,
    title: '分场剧本微观子工作流',
    requireConfirmation: false,
  });
  engine.registerWorkflow({
    key: 'subwf-storyboard',
    execute: storyboardSubWorkflow as any,
    title: '视听分镜微观子工作流',
    requireConfirmation: false,
  });
  engine.registerWorkflow({
    key: 'subwf-keyframe-reference',
    execute: keyframeReferenceSubWorkflow as any,
    title: '关键帧参考图微观子工作流',
    requireConfirmation: false,
  });
  engine.registerWorkflow({
    key: 'subwf-video-production',
    execute: videoProductionSubWorkflow as any,
    title: '动态视频切片微观子工作流',
    requireConfirmation: false,
  });
}


