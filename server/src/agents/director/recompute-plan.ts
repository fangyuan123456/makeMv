/**
 * agents/director/recompute-plan.ts
 * 增量重算清单（Dry-Run Recompute Plan）
 *
 * ── 这一层回答什么 ──
 * 「改完之后，到底要重做哪几样东西，代价多大」。它是血缘图、指纹、影响面
 * 三者的汇合点，也是 P4 里唯一面向人决策的产物。
 *
 * ── 为什么必须是交集 ──
 *   影响面 = 理论上哪些下游会失效（从依赖图推的，可能多算）
 *   陈旧   = 实际上哪些资产的上游内容真的变了（指纹 hash，精确）
 * 两者取交集才是「本次改动真正要重做的」。只用影响面会退化成全量重算，
 * 只用陈旧会把上一次改动遗留的脏账混进本次清单。
 *
 * ── 诚实边界 ──
 * 1. 无历史指纹（老数据）一律单列 unknown，不自动纳入执行清单；
 * 2. 影响面归因不到的陈旧资产单列 otherStale，不默认执行；
 * 3. 没配单价就只给数量与秒数，绝不编一个金额；
 * 4. 本模块不触发任何渲染、不写盘、不改产物。执行是下一步，必须由人确认。
 *
 * ── 波次 ──
 * W1 首帧图 → W2 视频。首帧图重做时，依赖它的视频必须跟着重做，
 * 即使视频自己的指纹还没变（构建系统的传递性，不能漏）。
 */

import { buildLineage, queryImpact } from './lineage.js';
import type { ImpactQuery, ImpactResult } from './lineage.js';
import { findStaleAssets } from './fingerprint.js';

export type RecomputeReason =
  /** 指纹不符，纳入本次清单 */
  | 'stale'
  /** 指纹不符，但归因不到本次改动 → 历史遗留，单列 */
  | 'stale-outside-impact'
  /** 命中影响面但没有历史指纹，无法判定 → 单列 */
  | 'unknown-in-impact'
  /** 首帧图要重做，依赖它的视频必须跟着重做 */
  | 'depends-on-keyframe';

export interface RecomputeItem {
  kind: 'keyframe' | 'clip';
  /** 首帧图用 shotId，视频用 clipId */
  id: string;
  shotId: string;
  /** 执行波次：1 首帧图，2 视频 */
  wave: 1 | 2;
  reason: RecomputeReason;
  reasonText: string;
  /** 可复核的归因链，从资产回溯到改动对象 */
  chain: string[];
  durationSec?: number;
  /** 仅当配置了单价时才有值 */
  estimatedCost?: number;
}

export interface RecomputePricing {
  /** 每张首帧图单价（元） */
  keyframePerUnit?: number;
  /** 每段视频每秒单价（元） */
  videoPerSecond?: number;
  currency?: string;
}

export interface RecomputePlan {
  /** 默认建议执行的清单（已按波次排序） */
  items: RecomputeItem[];
  /** 归因不到本次改动的历史遗留陈旧，不默认执行 */
  otherStale: RecomputeItem[];
  /** 命中影响面但无历史指纹，需人工确认 */
  unknown: RecomputeItem[];
  counts: {
    keyframes: number;
    clips: number;
    otherStale: number;
    unknown: number;
  };
  estimate: {
    keyframeUnits: number;
    clipUnits: number;
    videoSeconds: number;
    costConfigured: boolean;
    currency: string;
    cost?: number;
    note: string;
  };
  /** 影响面精度与数据缺失等提示，必须原样展示给人 */
  warnings: string[];
  usedGranularity: 'shot' | 'node' | 'none';
  summary: string;
}

export interface RecomputePlanOptions {
  /** 本次改动的影响面查询条件；不传则做全项目清单 */
  query?: ImpactQuery;
  /** 已算好的影响面（审批卡里已算过就传进来，避免重复） */
  impact?: ImpactResult;
  pricing?: RecomputePricing;
}

const REASON_TEXT: Record<RecomputeReason, string> = {
  stale: '上游内容已变（指纹不符）',
  'stale-outside-impact': '历史遗留陈旧，与本次改动无归因关系',
  'unknown-in-impact': '命中影响面但无历史指纹，无法判定',
  'depends-on-keyframe': '依赖的首帧图将重做，视频必须跟着重做',
};

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

function str(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pick(stageArtifacts: Record<string, any> | undefined, keys: string[]): any {
  for (const key of keys) {
    const v = stageArtifacts?.[key];
    if (v) return v;
  }
  return undefined;
}

function indexBy(items: any[], field: string): Map<string, any> {
  const map = new Map<string, any>();
  for (const item of items) {
    const id = str(item?.[field]);
    if (id) map.set(id, item);
  }
  return map;
}

/** 兼容血缘图里可能带 kind 前缀的 id */
function normalizeShotId(raw: string): string {
  return raw.replace(/^(shot|keyframe):/, '');
}

function makeItem(
  kind: 'keyframe' | 'clip',
  id: string,
  shotId: string,
  reason: RecomputeReason,
  chain: string[],
  durationSec?: number
): RecomputeItem {
  return {
    kind,
    id,
    shotId,
    wave: kind === 'keyframe' ? 1 : 2,
    reason,
    reasonText: REASON_TEXT[reason],
    chain: chain.length ? chain : [id],
    ...(durationSec !== undefined ? { durationSec } : {}),
  };
}

/**
 * 生成 dry-run 重算清单。纯函数：输入产物快照，输出可 JSON 序列化的清单。
 */
export function buildRecomputePlan(
  stageArtifacts: Record<string, any> | undefined,
  options: RecomputePlanOptions = {}
): RecomputePlan {
  const stale = findStaleAssets(stageArtifacts);
  const hasImpactScope = !!(options.impact || options.query);
  const impact = options.impact
    || (options.query ? queryImpact(buildLineage(stageArtifacts), options.query) : undefined);

  const clips = asArray<any>(pick(stageArtifacts, ['video_production', 'video-production', 'clip'])?.clips);
  const clipsByClipId = indexBy(clips, 'clipId');
  const clipsByShotId = indexBy(clips, 'shotId');
  const shotsById = indexBy(asArray<any>(pick(stageArtifacts, ['storyboard'])?.shots), 'shotId');

  // 影响面里的 shot 集合 + 每个 shot 的归因链
  const impactedShotIds = new Set<string>();
  const chainByShotId = new Map<string, string[]>();
  const putChain = (shotId: string, chain: string[]) => {
    if (!shotId) return;
    if (!chainByShotId.has(shotId) && chain.length) chainByShotId.set(shotId, chain);
  };
  for (const hit of impact?.shots || []) {
    const sid = normalizeShotId(hit.id);
    impactedShotIds.add(sid);
    putChain(sid, hit.chain);
  }
  for (const hit of impact?.keyframes || []) {
    const sid = normalizeShotId(hit.id);
    impactedShotIds.add(sid);
    putChain(sid, hit.chain);
  }
  for (const hit of impact?.clips || []) {
    const sid = str(clipsByClipId.get(hit.id)?.shotId) || normalizeShotId(hit.id.replace(/^clip_/, ''));
    impactedShotIds.add(sid);
    putChain(sid, hit.chain);
  }

  const chainOf = (shotId: string) => chainByShotId.get(shotId) || [shotId];
  const inScope = (shotId: string) => !hasImpactScope || impactedShotIds.has(shotId);

  const items: RecomputeItem[] = [];
  const otherStale: RecomputeItem[] = [];

  // W1：陈旧的首帧图
  for (const shotId of stale.staleKeyframes) {
    const item = makeItem('keyframe', shotId, shotId, 'stale', chainOf(shotId));
    (inScope(shotId) ? items : otherStale).push(item);
  }

  // W2：陈旧的视频
  for (const clipId of stale.staleClips) {
    const clip = clipsByClipId.get(clipId);
    const shotId = str(clip?.shotId) || normalizeShotId(clipId.replace(/^clip_/, ''));
    const duration = clip?.durationSec ?? shotsById.get(shotId)?.durationSec;
    const item = makeItem('clip', clipId, shotId, 'stale', chainOf(shotId), duration);
    (inScope(shotId) ? items : otherStale).push(item);
  }
  for (const item of otherStale) {
    item.reason = 'stale-outside-impact';
    item.reasonText = REASON_TEXT['stale-outside-impact'];
  }

  // 传递依赖：首帧图进了清单，依赖它的视频必须在清单里（即使它自己还没判陈旧）
  const plannedClipIds = new Set(items.filter((i) => i.kind === 'clip').map((i) => i.id));
  for (const kf of items.filter((i) => i.kind === 'keyframe')) {
    const clip = clipsByShotId.get(kf.shotId);
    if (!clip) continue; // 还没生成过视频，不需要重渲
    const clipId = str(clip.clipId);
    if (!clipId || plannedClipIds.has(clipId)) continue;
    items.push(
      makeItem(
        'clip',
        clipId,
        kf.shotId,
        'depends-on-keyframe',
        chainOf(kf.shotId),
        clip?.durationSec ?? shotsById.get(kf.shotId)?.durationSec
      )
    );
    plannedClipIds.add(clipId);
  }

  // unknown：命中影响面但没指纹，单列待人工确认
  const unknown: RecomputeItem[] = [];
  for (const shotId of stale.unknownKeyframes) {
    if (!impactedShotIds.has(shotId)) continue;
    unknown.push(makeItem('keyframe', shotId, shotId, 'unknown-in-impact', chainOf(shotId)));
  }
  for (const clipId of stale.unknownClips) {
    const clip = clipsByClipId.get(clipId);
    const shotId = str(clip?.shotId) || normalizeShotId(clipId.replace(/^clip_/, ''));
    if (!impactedShotIds.has(shotId)) continue;
    unknown.push(
      makeItem(
        'clip',
        clipId,
        shotId,
        'unknown-in-impact',
        chainOf(shotId),
        clip?.durationSec ?? shotsById.get(shotId)?.durationSec
      )
    );
  }

  items.sort((a, b) => a.wave - b.wave || a.id.localeCompare(b.id));

  // 估算：没配单价就只给数量与秒数
  const keyframeUnits = items.filter((i) => i.kind === 'keyframe').length;
  const clipItems = items.filter((i) => i.kind === 'clip');
  const videoSeconds = clipItems.reduce((acc, i) => acc + (i.durationSec || 0), 0);
  const pricing = options.pricing || {};
  const currency = pricing.currency || '¥';
  const costConfigured =
    typeof pricing.keyframePerUnit === 'number' || typeof pricing.videoPerSecond === 'number';
  const cost = costConfigured
    ? keyframeUnits * (pricing.keyframePerUnit || 0) + videoSeconds * (pricing.videoPerSecond || 0)
    : undefined;
  if (cost !== undefined) {
    for (const item of items) {
      item.estimatedCost =
        item.kind === 'keyframe'
          ? (pricing.keyframePerUnit || 0)
          : (item.durationSec || 0) * (pricing.videoPerSecond || 0);
    }
  }

  const warnings: string[] = [];
  if (impact?.incomplete) {
    warnings.push(`影响面数据不完整（缺少 ${impact.missing.join('、') || '部分产物'}），清单可能少算`);
  }
  if (impact?.usedGranularity === 'node') {
    warnings.push('按剧情节点粗算影响面，可能多算同节点空镜');
  }
  if (unknown.length) {
    warnings.push(`${unknown.length} 项命中影响面但无历史指纹（老数据），无法自动判定，需人工确认`);
  }
  if (otherStale.length) {
    warnings.push(`另有 ${otherStale.length} 项历史遗留陈旧，未纳入本次清单`);
  }
  if (!costConfigured) {
    warnings.push('未配置单价，仅给出数量与秒数，不做费用估算');
  }

  const scopeText = `${keyframeUnits} 张首帧图 · ${clipItems.length} 段视频${videoSeconds ? ` · ${videoSeconds}s` : ''}`;
  const parts = [`${items.length} 项待重做（${scopeText}）`];
  if (cost !== undefined) parts.push(`预估 ${currency}${cost.toFixed(2)}`);
  if (unknown.length) parts.push(`${unknown.length} 项待人工确认`);
  if (otherStale.length) parts.push(`${otherStale.length} 项历史遗留另列`);

  return {
    items,
    otherStale,
    unknown,
    counts: {
      keyframes: keyframeUnits,
      clips: clipItems.length,
      otherStale: otherStale.length,
      unknown: unknown.length,
    },
    estimate: {
      keyframeUnits,
      clipUnits: clipItems.length,
      videoSeconds,
      costConfigured,
      currency,
      ...(cost !== undefined ? { cost } : {}),
      note: costConfigured
        ? '按配置单价估算，实际费用以渲染服务结算为准'
        : '未配置单价：只提供资产数量与视频秒数，不编造金额',
    },
    warnings,
    usedGranularity: impact?.usedGranularity || 'none',
    summary: parts.join(' · ') + '。',
  };
}

/** 供 CLI / 日志打印的可读格式；同一份数据，不额外引入判断 */
export function formatRecomputePlan(plan: RecomputePlan): string {
  const lines: string[] = [];
  lines.push('重算清单（dry-run · 未执行）');
  lines.push('─'.repeat(40));
  lines.push(plan.summary);
  if (plan.items.length === 0) {
    lines.push('  （无需重做）');
  } else {
    for (const wave of [1, 2] as const) {
      const group = plan.items.filter((i) => i.wave === wave);
      if (!group.length) continue;
      lines.push(`[W${wave} ${wave === 1 ? '首帧图' : '视频'}] ${group.length} 项`);
      for (const item of group) {
        const sec = item.durationSec !== undefined ? ` · ${item.durationSec}s` : '';
        lines.push(`  ${item.id}  ${item.reasonText}${sec}`);
        lines.push(`    归因：${item.chain.join(' ← ')}`);
      }
    }
  }
  if (plan.unknown.length) {
    lines.push(`[待人工确认] ${plan.unknown.map((i) => i.id).join('、')}`);
  }
  if (plan.otherStale.length) {
    lines.push(`[历史遗留 · 未纳入] ${plan.otherStale.map((i) => i.id).join('、')}`);
  }
  if (plan.warnings.length) {
    lines.push('⚠ ' + plan.warnings.join('；'));
  }
  return lines.join('\n');
}
