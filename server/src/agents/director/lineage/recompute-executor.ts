/**
 * agents/director/lineage/recompute-executor.ts
 * 增量重算执行层：清单 → 波次 → 精确重渲
 *
 * ── 这一层回答什么 ──
 * dry-run 清单只算不做（recompute-plan.ts）。本层负责「人点头之后」的事：
 * 把清单转成现有渲染子工作流能吃的 targetShotIds，按 W1/W2 串行执行，
 * 并靠 setArtifact → provenance 自动回写指纹。
 *
 * ── 为什么不重写渲染器 ──
 * keyframe/video 的 audit.step 早就支持 targetShotIds：命中的镜头强制进
 * pendingShots，其余命中「断点复用」原样保留。所以精确重渲不用删产物、
 * 不用新写渲染入口，只要把镜头 id 传进去即可。产物全程保持完整，
 * 任务被驳回时不会留下一个半成品项目。
 *
 * ── 花钱的门禁（三重） ──
 * 1. 只有 proposed 任务被 startTask（人在审批卡点确认）才会走到执行体；
 * 2. 执行体要求 confirmed === true（由 approve 的 overrideParameters 传入），
 *    否则只回一份 dry-run 结果，不碰渲染；
 * 3. 波次为空 / 无清单时直接 no-op。
 * 本模块还提供 runIncrementalRecompute({ dryRun }) 与可注入 runner，
 * 使测试与离线核查能在完全不触发渲染的前提下覆盖全部编排逻辑。
 *
 * ── 保守回退 ──
 * decideRecompute 判定「数据是否足以精确重算」。算不准（老数据无指纹、
 * 影响面只能按节点粗算、已有资产却算出空清单、还有追加诉求会再改产物）
 * 时返回 fallback，交给 register.ts 沿用原来的整段清退 —— 宁可多渲，绝不静默漏渲。
 */

import { ProjectStore } from '../../../project-store/index.js';
import { buildRecomputePlan } from './recompute-plan.js';
import type { RecomputePlan } from './recompute-plan.js';
import { resolveImpactTargets } from '../modifier/impact.js';
import type { ImpactQuery } from './lineage.js';
import { findStaleAssets } from './fingerprint.js';
import { keyframeReferenceSubWorkflow } from '../generator/steps/keyframe-reference/keyframe-reference.workflow.js';
import { videoProductionSubWorkflow } from '../generator/steps/video-production/video-production.workflow.js';

/* ══════════════════════════════════════════════════════════════════════
 * 1. 波次编排（纯函数）
 * ══════════════════════════════════════════════════════════════════════ */

export interface RecomputeWavePlan {
  /** 本次涉及的镜头，也是审批卡上的勾选单位 */
  shotIds: string[];
  /** W1 首帧图要重渲的 shotId */
  wave1ShotIds: string[];
  /** W2 视频要重渲的 shotId */
  wave2ShotIds: string[];
  /** 传入但不在清单里的镜头（防误传） */
  skippedShotIds: string[];
  summary: string;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => typeof v === 'string' && v.trim())));
}

/**
 * 勾选粒度是「镜头」而不是「资产条目」：一个镜头的首帧图与视频必须同进同出，
 * 只重渲其中一样会留下画面对不上的中间态。清单生成时的传递依赖也因此天然闭合。
 */
export function buildRecomputeWaves(
  plan: RecomputePlan,
  selectedShotIds?: string[]
): RecomputeWavePlan {
  const all = dedupe(plan.items.map((i) => i.shotId));
  const valid = new Set(all);
  const skippedShotIds = selectedShotIds
    ? dedupe(selectedShotIds).filter((s) => !valid.has(s))
    : [];
  const chosen = new Set(selectedShotIds ? all.filter((s) => selectedShotIds.includes(s)) : all);

  const wave1ShotIds = dedupe(
    plan.items.filter((i) => i.kind === 'keyframe' && chosen.has(i.shotId)).map((i) => i.shotId)
  );
  const wave2ShotIds = dedupe(
    plan.items.filter((i) => i.kind === 'clip' && chosen.has(i.shotId)).map((i) => i.shotId)
  );

  return {
    shotIds: all,
    wave1ShotIds,
    wave2ShotIds,
    skippedShotIds,
    summary: `${wave1ShotIds.length} 张首帧图 · ${wave2ShotIds.length} 段视频（${chosen.size} 个镜头）`,
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * 2. 精确 / 回退决策（纯函数）
 * ══════════════════════════════════════════════════════════════════════ */

export type RecomputeDecision =
  | {
      mode: 'precise';
      plan: RecomputePlan;
      query: ImpactQuery;
      targets: string[];
      waves: RecomputeWavePlan;
    }
  | { mode: 'fallback'; reason: string };

export interface DecideOptions {
  /** 同一句话里还有下游追加诉求：它会在本单之后再次改产物，清单会立刻过期 */
  hasFollowUpAsks?: boolean;
}

function pick(stageArtifacts: Record<string, any> | undefined, keys: string[]): any {
  for (const key of keys) {
    const v = stageArtifacts?.[key];
    if (v) return v;
  }
  return undefined;
}

function countMediaAssets(stageArtifacts: Record<string, any> | undefined): number {
  const kfs = pick(stageArtifacts, ['keyframe_reference', 'keyframe-reference', 'keyframe'])?.shots;
  const clips = pick(stageArtifacts, ['video_production', 'video-production', 'clip'])?.clips;
  return (Array.isArray(kfs) ? kfs.length : 0) + (Array.isArray(clips) ? clips.length : 0);
}

/**
 * 判定本次修改能否走「精确重算」。
 *
 * 回退不是失败，而是诚实：老项目没有指纹、血缘图不全、或本次还挂着会再改
 * 产物的追加诉求时，任何「精确」结论都可能是漏渲。这些情况一律沿用原来
 * 按阶段整段清退 + 全量重推的老路。
 */
export function decideRecompute(
  stageArtifacts: Record<string, any> | undefined,
  instruction: string,
  options: DecideOptions = {}
): RecomputeDecision {
  const targets = resolveImpactTargets(stageArtifacts, instruction);
  const query: ImpactQuery = {
    characters: targets.characters,
    nodeIds: targets.nodeIds,
    shotIds: targets.shotIds,
  };
  const hasQuery = targets.characters.length + targets.nodeIds.length + targets.shotIds.length > 0;
  if (!hasQuery) {
    return { mode: 'fallback', reason: '识别不到改动对象，影响面不可靠' };
  }
  if (options.hasFollowUpAsks) {
    return { mode: 'fallback', reason: '同句含下游追加诉求，产物还会再改，清单会立即过期' };
  }

  let plan: RecomputePlan;
  try {
    plan = buildRecomputePlan(stageArtifacts, { query });
  } catch (err: any) {
    return { mode: 'fallback', reason: `清单计算异常：${err?.message || '未知异常'}` };
  }

  if (plan.unknown.length > 0) {
    return { mode: 'fallback', reason: `${plan.unknown.length} 项命中影响面但无历史指纹，无法判定，不能精确重渲` };
  }
  if (plan.otherStale.length > 0) {
    return { mode: 'fallback', reason: `${plan.otherStale.length} 项陈旧归因不到本次改动，数据不可信` };
  }

  const mediaCount = countMediaAssets(stageArtifacts);
  if (mediaCount === 0) {
    // 尚无媒体资产时沿用原有工序推进：精确模式的意义是「保住已经花钱渲出来的图」，
    // 没有图可保，就没必要绕开状态机，否则下一工序提案会指错地方。
    return { mode: 'fallback', reason: '项目尚无已生成的首帧图或视频，沿用原有工序推进' };
  }

  /*
   * 血缘图把「任一层产物缺失」都记为 incomplete（例如老项目没有分场剧本），
   * 若把它当硬闸门，精确模式几乎永远启用不了。真正决定能不能精确的是
   * 影响面粒度：所有镜头都自带出镜声明（usedGranularity === 'shot'）时，
   * 角色改动是顺着 declares 边精确定位的，缺几层上游不改变结论。
   * incomplete 仍作为 warning 原样进审批卡，由人自己判断要不要确认。
   */
  if (plan.usedGranularity !== 'shot') {
    return { mode: 'fallback', reason: '按剧情节点粗算影响面，精度不足以精确重渲' };
  }
  /*
   * 有已生成资产、却算出「一项都不用重做」时不能当精确结论采信：
   * 可能是角色没登记进 storyGraph 导致影响面算漏。此时保留原产物不删，
   * 等于是静默漏渲，比全量重渲糟得多 —— 回退。
   */
  if (plan.items.length === 0) {
    return { mode: 'fallback', reason: '已有媒体资产但清单为空，无法排除影响面算漏' };
  }

  return {
    mode: 'precise',
    plan,
    query,
    targets: targets.labels,
    waves: buildRecomputeWaves(plan),
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * 3. 波次执行（唯一会花钱的地方）
 * ══════════════════════════════════════════════════════════════════════ */

export type SubWorkflowKind = 'keyframe' | 'video';
export type SubWorkflowRunner = (kind: SubWorkflowKind, ctx: any) => Promise<any>;

/** 真实 runner：调现成的微观子工作流，targetShotIds 决定只重渲哪些镜头。 */
async function defaultRunner(kind: SubWorkflowKind, ctx: any): Promise<any> {
  const sub = kind === 'keyframe' ? keyframeReferenceSubWorkflow : videoProductionSubWorkflow;
  const run = await (sub as any).createRun();
  const res = await run.start({ inputData: ctx });
  return (res?.results as any)?.output || (res as any)?.output || res;
}

export interface RunRecomputeOptions {
  projectId: string;
  sessionId?: string;
  plan: RecomputePlan;
  waves: RecomputeWavePlan;
  /** 人在审批卡上点确认才会是 true */
  confirmed: boolean;
  /** 默认 true：只回编排结果，绝不触发渲染 */
  dryRun?: boolean;
  /** 注入假 runner 后，即使 confirmed 也不会花一分钱 */
  runner?: SubWorkflowRunner;
  selectedShotIds?: string[];
}

export interface RecomputeExecutionResult {
  executed: boolean;
  dryRun: boolean;
  confirmed: boolean;
  waves: RecomputeWavePlan;
  warnings: string[];
  /** 执行后仍被判定为陈旧的资产（指纹没刷上来，需要人复核） */
  stillStale: string[];
  summary: string;
}

function noopResult(
  options: RunRecomputeOptions,
  waves: RecomputeWavePlan,
  reason: string
): RecomputeExecutionResult {
  return {
    executed: false,
    dryRun: true,
    confirmed: options.confirmed,
    waves,
    warnings: [],
    stillStale: [],
    summary: `增量重算未执行（${reason}）· ${waves.summary}`,
  };
}

/**
 * 按 W1 首帧图 → W2 视频串行执行。W2 必须等 W1 落盘，否则视频会拿旧首帧图。
 * 指纹回写由 setArtifact → provenance 统一完成，这里只做事后核验。
 */
export async function runIncrementalRecompute(
  options: RunRecomputeOptions
): Promise<RecomputeExecutionResult> {
  const waves = options.selectedShotIds
    ? buildRecomputeWaves(options.plan, options.selectedShotIds)
    : options.waves;

  if (!options.confirmed) return noopResult(options, waves, '未获得人工确认');
  if (options.dryRun !== false) return noopResult(options, waves, 'dry-run');
  if (waves.wave1ShotIds.length === 0 && waves.wave2ShotIds.length === 0) {
    return noopResult(options, waves, '清单为空，无镜头需要重渲');
  }

  const runner = options.runner || defaultRunner;
  const warnings: string[] = [];
  if (waves.skippedShotIds.length) {
    warnings.push(`以下镜头不在清单中，已忽略：${waves.skippedShotIds.join('、')}`);
  }

  for (const wave of [
    { kind: 'keyframe' as const, shotIds: waves.wave1ShotIds, label: 'W1 首帧图' },
    { kind: 'video' as const, shotIds: waves.wave2ShotIds, label: 'W2 视频' },
  ]) {
    if (wave.shotIds.length === 0) continue;
    try {
      await runner(wave.kind, {
        projectId: options.projectId,
        sessionId: options.sessionId,
        payload: {
          targetShotIds: wave.shotIds,
          // 明确不是全量重推，audit.step 会据此只把命中镜头放进 pendingShots
          forceRegenerate: false,
        },
      });
    } catch (err: any) {
      // W1 失败就绝不跑 W2：拿旧首帧图渲视频只会产出一批要重做的废片
      return {
        executed: false,
        dryRun: false,
        confirmed: true,
        waves,
        warnings: [...warnings, `${wave.label} 执行失败：${err?.message || '未知异常'}`],
        stillStale: [],
        summary: `增量重算在 ${wave.label} 中断，后续波次未执行：${err?.message || '未知异常'}`,
      };
    }
  }

  // 事后核验：重渲过的资产必须带上与当前上游一致的新指纹
  const stillStale: string[] = [];
  try {
    const after = findStaleAssets(ProjectStore.getInstance().getProject(options.projectId)?.stageArtifacts);
    const w1 = new Set(waves.wave1ShotIds);
    const plannedClipIds = new Set(
      options.plan.items.filter((i) => i.kind === 'clip' && waves.wave2ShotIds.includes(i.shotId)).map((i) => i.id)
    );
    for (const id of after.staleKeyframes) if (w1.has(id)) stillStale.push(id);
    for (const id of after.staleClips) if (plannedClipIds.has(id)) stillStale.push(id);
  } catch (err: any) {
    warnings.push(`指纹复核失败（不影响产物）：${err?.message || '未知异常'}`);
  }
  if (stillStale.length) {
    warnings.push(`${stillStale.length} 项重渲后指纹仍未刷新，请人工复核：${stillStale.join('、')}`);
  }

  return {
    executed: true,
    dryRun: false,
    confirmed: true,
    waves,
    warnings,
    stillStale,
    summary: `增量重算完成：${waves.summary}${stillStale.length ? `，${stillStale.length} 项待复核` : ''}。`,
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * 4. 注册到工作流引擎的执行体
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 只有审批卡 approve 时把 confirmed 放进 overrideParameters 才会真跑。
 * 直接 dispatch 一个任务、或被脚本误调，都只会拿到 dry-run 结果。
 */
export function createIncrementalRecomputeExecutor(runner?: SubWorkflowRunner) {
  return async ({ inputData }: { inputData: any }) => {
    const { projectId, sessionId, payload, overrideParams } = inputData || {};
    const confirmed = payload?.confirmed === true || overrideParams?.confirmed === true;
    const plan: RecomputePlan | undefined = payload?.recomputePlan;

    if (!plan || !Array.isArray(plan.items)) {
      return {
        ...inputData,
        success: true,
        toolResult: { executed: false, dryRun: true },
        lastSummary: '增量重算：审批卡未携带清单，未执行任何渲染。',
      };
    }

    const waves = buildRecomputeWaves(plan, payload?.selectedShotIds || overrideParams?.selectedShotIds);
    const result = await runIncrementalRecompute({
      projectId,
      sessionId,
      plan,
      waves,
      confirmed,
      // 显式写死：真执行只可能是「人确认过的这个任务」
      dryRun: confirmed ? false : true,
      selectedShotIds: payload?.selectedShotIds || overrideParams?.selectedShotIds,
      // 生产不传，用真实子工作流；测试注入假 runner 覆盖全流程且不花一分钱
      ...(runner ? { runner } : {}),
    });

    return {
      ...inputData,
      success: true,
      toolResult: result,
      data: result,
      lastSummary: result.summary,
    };
  };
}
