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
import { ProjectStore } from '../../../project-store/index.js';
import { WorkflowStage, SessionStatus, STAGE_SEQUENCE } from '../../../types/index.js';
import {
  STEP_MANIFESTS,
  getStepManifest,
  STAGE_TRANSITION_MAP,
  STAGE_OF_SKILL,
  SKILL_OF_STAGE,
  SKILL_TITLES,
} from './constants.js';
import { modifierWorkflow } from '../modifier/modifier.workflow.js';
import { getModifierSpec } from '../modifier/manifest.js';
import { scheduleFollowUpAsks } from '../modifier/follow-up.js';
import { peekStageDirectives, clearStageDirectives } from '../modifier/stage-directives.js';

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
        // 【定向微调因果链路自愈】：按「本次真实改动的阶段集合」清理下游过时资产与审查门禁
        //
        // 文本轨一次可能同步改掉故事圣经 + 剧本 + 分镜，若仍按单一 skillStage 推下游，
        // 会把刚刚同步好的产物当成过期资产删掉。因此以修改轨上报的 changedStages 为准，
        // 取其最大阶段序作为清理起点；未上报时回落旧的单工序口径。
        const reportedStages: string[] = Array.isArray(ctx.result?.changedStages)
          ? ctx.result.changedStages
          : [];
        const changedOrders = (reportedStages.length
          ? reportedStages
          : skillStage
            ? [skillStage as string]
            : []
        )
          .map((s) => STAGE_SEQUENCE.indexOf(s as WorkflowStage))
          .filter((i) => i >= 0);

        if (changedOrders.length > 0) {
          const latestOrder = Math.max(...changedOrders);
          let cleanedDownstreamCount = 0;
          for (let i = latestOrder + 1; i < STAGE_SEQUENCE.length; i++) {
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

          // 阶段回退到「本次改动的最后一份产物」所在阶段：它才是当前最新的有效起点
          if (latestOrder < currentOrder) {
            project.currentStage = STAGE_SEQUENCE[latestOrder];
          }

          project.updatedAt = new Date().toISOString();
          projectStore.saveProject(project);
          console.log(
            `[WorkflowEngine] 项目 [${ctx.projectId}] 定向微调工序 [${skillKey}] 完成 ` +
              `(改动阶段: ${STAGE_SEQUENCE[latestOrder]}，清理下游过时资产: ${cleanedDownstreamCount})`
          );
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
          // 定向微调落盘后，当前阶段的主责工序即被重做的那个工序，已是最新。
          // 下一工序必须指向「后续阶段」的主责技能；若仍取 SKILL_OF_STAGE[currentStage]，
          // 会把刚改完的工序自己再推一遍，形成「改稿完成 → 又让你改稿」的循环提案。
          const currentStageSkill = SKILL_OF_STAGE[project.currentStage];
          const nextStage = currentStageSkill ? STAGE_TRANSITION_MAP[currentStageSkill] : undefined;
          if (nextStage && nextStage !== WorkflowStage.COMPLETED) {
            nextSkillToPropose = SKILL_OF_STAGE[nextStage];
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

      // 就绪下一工序：dispatch 直接产出一个 proposed 任务（未开始 / 待确认），
      // 对话消息只需引用 taskId，不再在消息里塞提案快照。
      if (nextSkillToPropose) {
        const nextTitle = SKILL_TITLES[nextSkillToPropose] || nextSkillToPropose;
        try {
          const dispatchRes = await Workflow.getInstance().dispatch({
            projectId: ctx.projectId,
            sessionId: ctx.sessionId,
            workflowKey: nextSkillToPropose,
            actionType: 'PROCEED_STAGE',
            title: `启动下一工序：${nextTitle}`,
            reason: `工序【${title}】已成功落盘，提议启动下一工序【${nextTitle}】`,
            requireConfirmation: true, // 100% 保持 proposed，人在回路，等待创作者点击或打字授权
          });

          /*
           * 衔接文案：派发只让任务出现在任务仓库，创作者在聊天流里看不到任何解释。
           * 追加到【刚完成任务的最后一条消息】正文里——气泡原地生长
           * （启动文案 → 追加完成+下一工序引导），绝不为它单开新气泡。
           * 无条件追加：下一工序提醒由系统全权负责（提示词已禁止模型输出此类流程话术），
           * 不做内容去重——模型谈创作时顺带提到工序名属正常，不能因此吞掉系统提醒。
           */
          if (dispatchRes.task && ctx.sessionId) {
            projectStore.appendToLastTaskMessage(
              ctx.projectId,
              ctx.sessionId,
              ctx.taskId,
              `【${title}】已完成 ✅ 已为你准备下一工序【${nextTitle}】，请在输入框旁确认后授权启动。`
            );
          }
        } catch (err: any) {
          console.warn(`[WorkflowEngine] 自动就绪下一工序任务非致命提示:`, err.message);
        }
      }

      /*
       * 跨源头追加诉求（「台词压短，另外关键帧光影调暗」）。
       *
       * 必须放在这里：只有主单真正落盘、下游清退也执行完之后，才知道第二个源头
       * 的产物还在不在——在就按修改接单，被清退就按指令重新生成。放在派发时做，
       * 只能靠猜。
       */
      // 阶段待办已随本次生成生效，清除；修改轨不清（它没消费待办，留着等下次生成）
      if (!isTargetedRevise && skillStage) {
        clearStageDirectives(ctx.projectId, skillStage);
      }

      if (isTargetedRevise) {
        try {
          await scheduleFollowUpAsks({
            projectId: ctx.projectId,
            sessionId: ctx.sessionId,
            payload: { ...(ctx.payload || {}), taskId: ctx.taskId },
          });
        } catch (err: any) {
          console.warn(`[WorkflowEngine] 追加诉求接单失败（不影响主单）:`, err?.message || err);
        }
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
      // 修改轨只有一条路线：唯一那条微调 workflow（按媒介命中 text / image / video 之一，
      // 命中分支内部走 读取底稿 → 推演变更 → 执行落地 → 聚合落盘）。
      // 工序差异由 spec 承载，不存在「回落单体实现」的第二条路径。
      if (!getModifierSpec(skillKey)) {
        throw new Error(`工序 [${skillKey}] 未声明微调规格，不支持定向修改`);
      }
      console.log(`[ModifierPipeline] 工序 [${skillKey}] 走微调工作流（按媒介命中对应分支）`);
      return await modifierWorkflow.execute({ inputData });
    }

    /*
     * 阶段待办指令：同一句话里落在这一步的要求（「关键帧光影调暗」），当时没有
     * 产物可改、上游也没就绪，就挂在工序上。轮到真正生成这一步时，把它并进
     * 创作者原话一起送进 prompt——生成轨各处读的都是 inputData.feedback。
     */
    const stage = STAGE_OF_SKILL[skillKey];
    const directives = stage ? peekStageDirectives(inputData.projectId, stage) : [];
    if (directives.length > 0) {
      const merged = [inputData.feedback, ...directives.map((d) => d.text)]
        .map((t) => String(t || '').trim())
        .filter(Boolean)
        .join('\n');
      inputData.feedback = merged;
      if (inputData.payload) inputData.payload.userPrompt = merged;
      console.log(
        `[WorkflowEngine] 工序 [${skillKey}] 携带 ${directives.length} 条阶段待办: ${directives
          .map((d) => `「${d.text}」`)
          .join('、')}`
      );
    }

    // 默认顺向标准 Step 执行
    const executeFn = typeof standardStep === 'function' ? standardStep : standardStep.execute.bind(standardStep);
    return await executeFn({ inputData });
  };
}

/**
 * 向微内核通用工作流引擎注册全量 8 大法定工序
 *
 * 注意这里注册的是「工序」而非「流水线」：8 个工序各自可被单独按 key 唤起（单工序重跑、
 * 定向微调），同时它们也是 film-production-pipeline 的节点（同一批 step 对象双处引用）。
 *
 * 门禁与阶段推进**不在这里配置**：
 * - 门禁 → createPipelineGateValidator(key) 内部查 STAGE_OF_SKILL
 * - 阶段推进/下游清理 → createPipelineSuccessHandler(key) 内部查 STAGE_TRANSITION_MAP
 * 注册项上的 legalStage / nextStage 字段引擎从不读取，传了只会造成「配置生效」的错觉，
 * 且 critic-review 的默认阶段是叙事设计（切面审计），一旦未来引擎改为读该字段会误拦。
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
      // 显式兜底 false：目录里 8 条均为 false，若未来出现缺 manifest 的工序，行为可预期
      requireConfirmation: manifest?.requireConfirmation ?? false,
      validateGate: createPipelineGateValidator(key),
      onSuccess: createPipelineSuccessHandler(key),
    });
  }

  // 微观子工作流（subwf-*）不在此注册：它们由各工序内部直接持有对象执行
  // （见 generator/manifest.ts 的 step 装配）。单独注册只会多出一个绕过门禁与
  // 状态机推进的合法入口，属于隐患而非能力。
}
