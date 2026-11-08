/**
 * agents/director/modifier/impact.ts
 * 修改任务的影响面预览（挂到待确认卡片上）
 *
 * ── 职责边界 ──
 * 只做「算 + 序列化」，不写产物、不触发重渲、不改审批流程。
 * 结果作为提示信息附在 Task.payload.impact 上，创作者批准前能看到：
 * 这一改会让哪些已生成的镜头/首帧/视频作废、以及为什么（归因链）。
 *
 * ── 诚实优先 ──
 * 识别不出具体变更对象时返回 null（前端就不展示这块），绝不退化成
 * 「全项目受影响」这种看起来有数、实际是猜的结论。估算不稳比没估算更糟，
 * 因为重渲要花真钱。
 */

import { buildLineage, queryImpact, type ImpactQuery, type ImpactResult } from '../lineage/lineage.js';

export interface ImpactSample {
  id: string;
  /** 从资产回溯到变更对象的归因链，如 [clip_shot_3, shot_3, 家人下落, 李明] */
  chain: string[];
}

export interface TaskImpactPreview {
  /** 一句话结论，直接展示 */
  summary: string;
  /** 系统按什么算的——必须让用户看得见，否则数字不可信 */
  targets: string[];
  granularity: 'shot' | 'node';
  incomplete: boolean;
  counts: {
    scenes: number;
    shots: number;
    keyframes: number;
    clips: number;
  };
  /** 最多 6 条代表性归因链 */
  samples: ImpactSample[];
  missing: string[];
}

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

function str(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickArtifact(stageArtifacts: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    const v = stageArtifacts?.[key];
    if (v) return v;
  }
  return undefined;
}

/**
 * 从一句人话里识别「改了谁」。
 *
 * 只用确定性规则，不调 LLM：这是审批卡上的提示信息，不能为了一个提示
 * 再花一次调用、再引入一次不确定性。识别不到就返回空，前端不展示。
 */
export function resolveImpactTargets(
  stageArtifacts: Record<string, any> | undefined,
  instruction: string
): { characters: string[]; nodeIds: string[]; shotIds: string[]; labels: string[] } {
  const result = { characters: [] as string[], nodeIds: [] as string[], shotIds: [] as string[], labels: [] as string[] };
  const text = str(instruction);
  if (!text) return result;

  const bible = pickArtifact(stageArtifacts || {}, ['narrative_design', 'story_bible', 'story-bible']);
  const characters = asArray<any>(bible?.characters);
  const names = new Set<string>();
  for (const name of asArray<string>(bible?.characterNames)) if (str(name).length >= 2) names.add(str(name));
  for (const c of characters) if (str(c?.name).length >= 2) names.add(str(c.name));

  // 按名字长度降序，先吃「李明的妻子」再吃「李明」，避免短名抢先命中
  for (const name of Array.from(names).sort((a, b) => b.length - a.length)) {
    if (!text.includes(name)) continue;
    if (result.characters.some((c) => c.includes(name) || name.includes(c))) continue;
    result.characters.push(name);
    result.labels.push(name);
  }

  /*
   * 「把主角改成女的」这类不点名的指令：按剧情节点出现频次认领，且必须
   * 唯一领先才敢认。不用 role 文本判——数据里「男主角」「女主角」同时存在，
   * 正则会把两个都算成主角，结果只能不猜；而出场频次是作品结构，不是展示文案。
   */
  if (result.characters.length === 0 && /主角/.test(text)) {
    const freq = new Map<string, number>();
    for (const n of asArray<any>(bible?.storyGraph?.nodes)) {
      for (const raw of asArray<string>(n?.characterNames)) {
        const name = str(raw);
        if (name) freq.set(name, (freq.get(name) || 0) + 1);
      }
    }
    const ranked = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
    if (ranked.length > 0 && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
      result.characters.push(ranked[0][0]);
      result.labels.push(`主角（${ranked[0][0]}）`);
    }
  }

  for (const m of text.matchAll(/node[_-]?(\d+)/gi)) {
    const id = `node_${m[1]}`;
    if (!result.nodeIds.includes(id)) {
      result.nodeIds.push(id);
      result.labels.push(id);
    }
  }
  for (const m of text.matchAll(/shot[_-]?(\d+)/gi)) {
    const id = `shot_${m[1]}`;
    if (!result.shotIds.includes(id)) {
      result.shotIds.push(id);
      result.labels.push(id);
    }
  }

  return result;
}

function toSamples(r: ImpactResult): ImpactSample[] {
  // 视频片段最能说明「要花多少钱」，优先展示；不足再补首帧、镜头
  const ordered = [...r.clips, ...r.keyframes, ...r.shots, ...r.scenes];
  return ordered.slice(0, 6).map((h) => ({ id: h.id, chain: h.chain }));
}

/**
 * 生成待确认卡片用的影响面。
 *
 * 任何异常都吞掉并返回 null——提示信息绝不能让修改任务派发失败。
 */
export function previewModifyImpact(
  stageArtifacts: Record<string, any> | undefined,
  instruction: string
): TaskImpactPreview | null {
  try {
    const targets = resolveImpactTargets(stageArtifacts, instruction);
    if (targets.characters.length + targets.nodeIds.length + targets.shotIds.length === 0) {
      return null;
    }

    const graph = buildLineage(stageArtifacts);
    const query: ImpactQuery = {
      characters: targets.characters,
      nodeIds: targets.nodeIds,
      shotIds: targets.shotIds,
    };
    const r = queryImpact(graph, query);
    const counts = {
      scenes: r.scenes.length,
      shots: r.shots.length,
      keyframes: r.keyframes.length,
      clips: r.clips.length,
    };
    const hasAssets = counts.shots + counts.keyframes + counts.clips > 0;

    const summary = hasAssets
      ? r.summary
      : `${r.nodes.length > 0 ? `关联 ${r.nodes.length} 个剧情节点；` : ''}当前项目尚无已生成的镜头或视频，暂不需要重做。`;

    return {
      summary,
      targets: targets.labels,
      granularity: r.usedGranularity,
      incomplete: r.incomplete,
      counts,
      samples: toSamples(r),
      missing: r.missing,
    };
  } catch (err: any) {
    console.warn(`[ImpactPreview] 影响面计算失败，本次修改照常派发: ${err?.message || '未知异常'}`);
    return null;
  }
}
