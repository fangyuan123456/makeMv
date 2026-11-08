/**
 * agents/director/lineage/fingerprint.ts
 * 上游内容指纹与资产陈旧判定 (Input Fingerprint & Stale Detection)
 *
 * ── 为什么需要 ──
 * 血缘图回答「改了 X，理论上哪些资产会失效」；指纹回答「这些资产实际是基于
 * 哪一版上游生成的，现在还新不新」。没有指纹，任何一次触碰都会被当成变更，
 * 增量重算就退化成全量重算。
 *
 * 判定方式是一次 hash 比较：生成时把「这份资产用到的上游内容」算成指纹存下来，
 * 查询时按当前产物重算，不等就是陈旧。毫秒级、确定、可单测，不需要问模型。
 *
 * ── 指纹里放什么 ──
 * 只放「会影响画面/视频结果」的字段。易变的运行态字段（imageUrl、status、
 * createdAt、isDegraded、degradedReason）一律排除，否则每次落盘都算陈旧。
 * 角色只取该镜头出镜的那几个的外貌相关字段——改一个没出镜的角色不该让
 * 这个镜头重渲。
 *
 * ── 老数据口径 ──
 * 没有 inputFingerprint 的资产一律记为 unknown，不计入 stale。
 * 存量项目不能因为新机制上线就被全量标脏，那样等于一次强制全量重渲。
 *
 * ── 边界 ──
 * 本模块只算，不写、不触发重渲。生成轨在落盘前调用 compute*Fingerprint
 * 把值写进资产，是后续接入步骤。
 */

import { createHash } from 'crypto';

/** 镜头里会影响画面的字段（不含运行态/展示态字段） */
const SHOT_INPUT_FIELDS = [
  'nodeId',
  'shotNumber',
  'shotScale',
  'cameraMovement',
  'cameraTrajectory',
  'subjectMotion',
  'sceneDynamics',
  'durationSec',
  'visualComposition',
  'audioPrompt',
  'characterIds',
  'characterNames',
] as const;

/** 角色里会影响外貌一致性的字段 */
const CHARACTER_VISUAL_FIELDS = [
  'characterId',
  'name',
  'gender',
  'age',
  'appearance',
  'personality',
  'visualPromptKeywords',
] as const;

export interface StaleReport {
  /** 指纹与当前上游不符，需要重做 */
  staleKeyframes: string[];
  staleClips: string[];
  /** 没有历史指纹，无法判定（老数据） */
  unknownKeyframes: string[];
  unknownClips: string[];
  /** 指纹一致，无需动 */
  freshKeyframes: string[];
  freshClips: string[];
  summary: string;
}

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

function str(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 稳定序列化：对象键排序、忽略 undefined、数组保持原序。
 * 目的：字段书写顺序变化不能导致指纹变化（JSON.stringify 会）。
 */
export function stableStringify(value: any): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hash(value: any): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 20);
}

function pickFields(source: any, fields: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of fields) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function pickArtifact(stageArtifacts: Record<string, any> | undefined, keys: string[]): any {
  for (const key of keys) {
    const v = stageArtifacts?.[key];
    if (v) return v;
  }
  return undefined;
}

/**
 * 解析镜头声明的出镜角色，映射到故事圣经里的角色对象。
 * 同时认 characterIds 与 characterNames；按稳定 key 排序，保证指纹不随数组顺序变。
 */
function resolveShotCharacters(bible: any, shot: any): Array<Record<string, any>> {
  const chars = asArray<any>(bible?.characters);
  if (chars.length === 0) return [];

  const byId = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const c of chars) {
    const id = str(c?.characterId);
    const name = str(c?.name);
    if (id) byId.set(id, c);
    if (name) byName.set(name, c);
  }

  const refs = Array.isArray(shot?.characterIds)
    ? shot.characterIds
    : Array.isArray(shot?.characterNames)
      ? shot.characterNames
      : [];

  const resolved = new Map<string, any>();
  for (const raw of refs) {
    const ref = str(raw);
    if (!ref) continue;
    const c = byId.get(ref) || byName.get(ref);
    if (!c) continue;
    const key = str(c.characterId) || str(c.name) || ref;
    resolved.set(key, c);
  }

  return Array.from(resolved.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, c]) => pickFields(c, CHARACTER_VISUAL_FIELDS));
}

/**
 * 镜头的上游内容指纹：镜头自身的画面字段 + 出镜角色的视觉字段。
 * 角色表里没出镜的人怎么改，都不会让这个镜头变脏。
 */
export function computeShotFingerprint(bible: any, shot: any): string {
  const shotInput = pickFields(shot, SHOT_INPUT_FIELDS);
  /*
   * 出镜角色是集合不是序列：模型这次写 [A,B]、下次写 [B,A]，画面完全一样。
   * 排序后再入 hash，否则每次重新生成分镜都会把下游资产全判成陈旧。
   */
  for (const key of ['characterIds', 'characterNames'] as const) {
    if (Array.isArray(shotInput[key])) {
      shotInput[key] = shotInput[key]
        .map((v: any) => str(v))
        .filter(Boolean)
        .sort();
    }
  }
  return hash({
    v: 1,
    shot: shotInput,
    characters: resolveShotCharacters(bible, shot),
  });
}

/** 首帧图的生成输入指纹 = 镜头指纹（提示词是它的派生，不重复计入） */
export function computeKeyframeFingerprint(bible: any, shot: any): string {
  return computeShotFingerprint(bible, shot);
}

/**
 * 视频片段的生成输入指纹 = 镜头指纹 + 所用首帧图的提示词。
 * 首帧图换了（哪怕镜头字段没动），视频也必须重做。
 */
export function computeClipFingerprint(bible: any, shot: any, keyframe?: any): string {
  return hash({
    v: 1,
    shotFingerprint: computeShotFingerprint(bible, shot),
    keyframePrompt: str(keyframe?.prompt),
  });
}

/**
 * 全项目陈旧判定：把已生成的首帧图/视频片段按 fresh / stale / unknown 分桶。
 *
 * 任何异常都退回空报告——陈旧判定只是提示，不能因此卡住项目读取。
 */
export function findStaleAssets(stageArtifacts: Record<string, any> | undefined): StaleReport {
  const report: StaleReport = {
    staleKeyframes: [],
    staleClips: [],
    unknownKeyframes: [],
    unknownClips: [],
    freshKeyframes: [],
    freshClips: [],
    summary: '',
  };

  try {
    const bible = pickArtifact(stageArtifacts, ['narrative_design', 'story_bible', 'story-bible']);
    const storyboard = pickArtifact(stageArtifacts, ['storyboard']);
    const keyframes = asArray<any>(pickArtifact(stageArtifacts, ['keyframe_reference', 'keyframe'])?.shots);
    const clips = asArray<any>(pickArtifact(stageArtifacts, ['video_production', 'clip'])?.clips);

    const shotsById = new Map<string, any>();
    for (const shot of asArray<any>(storyboard?.shots)) {
      const id = str(shot?.shotId);
      if (id) shotsById.set(id, shot);
    }
    const keyframesByShot = new Map<string, any>();
    for (const kf of keyframes) {
      const id = str(kf?.shotId);
      if (id) keyframesByShot.set(id, kf);
    }

    for (const kf of keyframes) {
      const shotId = str(kf?.shotId) || '未知镜头';
      const stored = str(kf?.inputFingerprint);
      if (!stored) {
        report.unknownKeyframes.push(shotId);
        continue;
      }
      const expected = computeKeyframeFingerprint(bible, shotsById.get(shotId) || { shotId });
      (expected === stored ? report.freshKeyframes : report.staleKeyframes).push(shotId);
    }

    for (const clip of clips) {
      const clipId = str(clip?.clipId) || '未知片段';
      const shotId = str(clip?.shotId);
      const stored = str(clip?.inputFingerprint);
      if (!stored) {
        report.unknownClips.push(clipId);
        continue;
      }
      const expected = computeClipFingerprint(
        bible,
        shotsById.get(shotId) || { shotId },
        keyframesByShot.get(shotId)
      );
      (expected === stored ? report.freshClips : report.staleClips).push(clipId);
    }
  } catch (err: any) {
    console.warn(`[Fingerprint] 陈旧判定失败，按空报告处理: ${err?.message || '未知异常'}`);
  }

  const parts: string[] = [];
  if (report.staleKeyframes.length) parts.push(`${report.staleKeyframes.length} 张首帧图陈旧`);
  if (report.staleClips.length) parts.push(`${report.staleClips.length} 段视频陈旧`);
  if (report.unknownKeyframes.length + report.unknownClips.length) {
    parts.push(`${report.unknownKeyframes.length + report.unknownClips.length} 项无历史指纹（按新资产处理）`);
  }
  report.summary = parts.length ? parts.join('、') + '。' : '所有已生成资产与当前上游一致，无需重做。';
  return report;
}
