/**
 * agents/director/modifier/follow-up.ts
 * 跨源头追加诉求：主单落地之后，才轮到第二个源头
 *
 * ── 问题 ──
 * 「台词压短，另外这张关键帧的光影调暗一点」有两个源头。一次派发只能改一份产物，
 * 于是第二个源头要么被丢掉（创作者以为改了两处），要么在同批里和第一单互相清退
 * （改台词必然让关键帧过期，谁先谁后决定最后留下哪一份）。
 *
 * ── 做法 ──
 * 不在派发时执行，而是在**第一单成功之后**、下游清退也跑完之后再决定怎么接：
 *   - 目标产物还在  → TARGETED_REVISE，立一张待确认的修改任务（只动这一份）；
 *   - 目标产物已被主单清退 → DEFER，把这句话挂到该阶段上（stage-directives），
 *     等那一步真正重新生成时并进 feedback。此时既没有底稿可改，也不该立刻生成
 *     ——上游刚被改过还没重跑，现在生成必然缺料。
 * 修改任务一律派发成 proposed：它可能触发一次真金白银的重生成，必须由创作者
 * 点一下，不能在改完台词之后顺手替人花钱。
 *
 * 只处理 relation === 'downstream' 的诉求。上游诉求会把主单刚产出的东西清退，
 * 由调用方（chat.ts）记录但不接单；同文本轨的诉求本就由主单的跨文件补丁覆盖。
 */

import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { Workflow } from '../../../workflow-engine/index.js';
import { STAGE_SEQUENCE, WorkflowStage } from '../../../types/index.js';
import { STAGE_OF_SKILL } from '../constants.js';
import { addStageDirective } from './stage-directives.js';

/** 由 chat.ts 写进任务 payload 的追加诉求 */
export interface FollowUpAsk {
  clause: string;
  sourceSkill: string;
  sourceStage?: string;
  attribute?: string;
  relation?: string;
}

export interface PlannedFollowUp {
  skill: string;
  stage: string;
  /**
   * - TARGETED_REVISE：产物还在，按修改接单（立待确认任务）；
   * - DEFER：产物已被清退。此时既不能改（没有底稿），也不该立刻生成
   *   （上游还没重跑）。把要求挂在那个阶段上，等它下次生成时自动带上。
   */
  actionType: 'TARGETED_REVISE' | 'DEFER';
  /** 传给修改/生成轨的原话，必须是分句本身，不能是整句 */
  feedback: string;
  attribute?: string;
  reason: string;
}

/**
 * 纯函数：把追加诉求映射成待派发的动作。抽出来是为了能在单测里断言
 * 「产物还在就改、被清退就重生成」这条判据，而不必真的跑一遍工作流。
 */
export function planFollowUpTasks(
  artifacts: Record<string, any>,
  asks: FollowUpAsk[]
): PlannedFollowUp[] {
  const out: PlannedFollowUp[] = [];
  const seen = new Set<string>();

  for (const ask of asks) {
    if (!ask || ask.relation !== 'downstream') continue;
    const clause = String(ask.clause || '').trim();
    if (!clause) continue;

    const stage = (STAGE_OF_SKILL[ask.sourceSkill] ||
      (ask.sourceStage as WorkflowStage | undefined)) as string | undefined;
    if (!stage || STAGE_SEQUENCE.indexOf(stage as WorkflowStage) < 0) continue;
    if (seen.has(stage)) continue;
    seen.add(stage);

    const exists = Boolean(artifacts[stage]);
    out.push({
      skill: ask.sourceSkill,
      stage,
      actionType: exists ? 'TARGETED_REVISE' : 'DEFER',
      feedback: clause,
      attribute: ask.attribute,
      reason: exists
        ? `补充诉求「${clause}」（与上一单同句提出；上一单已落地，按修改执行）`
        : `补充诉求「${clause}」（${stage} 已被上一单清退，挂在该工序上，重新生成时一并执行）`,
    });
  }

  // 阶段升序：下游先接单没有意义——它依赖的产物刚刚被上游改过
  return out.sort(
    (a, b) =>
      STAGE_SEQUENCE.indexOf(a.stage as WorkflowStage) - STAGE_SEQUENCE.indexOf(b.stage as WorkflowStage)
  );
}

/**
 * 主单成功钩子：把追加诉求接成待确认任务。
 *
 * 派发成 proposed 而不是直接排队，原因见文件头。若下一工序的推进提案已经占用了
 * 同一个 skill，dispatch 的幂等逻辑会把本次的 userPrompt 合并进去——效果更好：
 * 那张「是否重新生成关键帧」的卡上，正好带着创作者这句要求。
 */
export async function scheduleFollowUpAsks(ctx: {
  projectId: string;
  sessionId?: string;
  payload?: any;
}): Promise<void> {
  const raw = ctx.payload?.followUpAsks;
  if (!Array.isArray(raw) || raw.length === 0) return;

  const project = ProjectStore.getInstance().getProject(ctx.projectId);
  if (!project) return;

  const planned = planFollowUpTasks(project.stageArtifacts || {}, raw as FollowUpAsk[]);
  if (planned.length === 0) return;

  const engine = Workflow.getInstance();
  for (const item of planned) {
    // 没有底稿可改、上游也还没重跑：挂在那个阶段上，等它自然到来
    if (item.actionType === 'DEFER') {
      const added = addStageDirective(ctx.projectId, item.stage, item.feedback, ctx.payload?.taskId);
      console.log(
        `[Modifier] 追加诉求挂到工序 [${item.stage}] 待生成时执行（${added ? '已记录' : '已存在，跳过'}）: 「${item.feedback}」`
      );
      continue;
    }

    try {
      const res = await engine.dispatch({
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
        workflowKey: item.skill,
        actionType: item.actionType,
        title: `补充诉求：${item.feedback}`,
        reason: item.reason,
        userPrompt: item.feedback,
        parameters: {
          userFeedback: item.feedback,
          sourceAttribute: item.attribute,
          followUpOf: ctx.payload?.taskId,
        },
        requireConfirmation: true,
      });
      console.log(
        `[Modifier] 追加诉求已就绪（按修改）: [${item.skill}] 「${item.feedback}」 → task=${res.taskId}`
      );
    } catch (err: any) {
      // 追加失败不能影响主单：主单已经落盘，这里只是把没做完的那半句接上
      console.warn(`[Modifier] 追加诉求派发失败（不影响主单）: ${item.skill} ${err?.message || err}`);
    }
  }
}
