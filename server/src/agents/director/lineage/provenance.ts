/**
 * agents/director/lineage/provenance.ts
 * 产物来源信息统一补齐 (Artifact Provenance)
 *
 * ── 为什么收在存储层 ──
 * 写 keyframe / clip 产物的入口有四处：生成轨的两个 aggregate step、修改轨的
 * 图片轨与视频轨。任何一处漏写 inputFingerprint，那条路径生成的资产就永远
 * 无法参与陈旧判定。所以和 character-identity 一样，统一收在 setArtifact 边界。
 *
 * ── 最关键的口径：绝不把旧资产伪装成新资产 ──
 * 产物支持「断点复用」：aggregate step 会把 cachedKeyframes / cachedClips 原样
 * 搬进新产物。若这里无条件按「当前上游」重算指纹，等于宣告那些旧图/旧视频
 * 是基于最新剧本生成的——该重渲的会被判成 fresh，漏渲比多渲更糟。
 *
 * 判据只用写入前快照，不依赖写入方配合：
 *   item 自带 inputFingerprint        → 保留（它记录的是生成当时那一版上游）
 *   prev 有同 id 条目且也没有指纹     → 存量老资产复用，保持 unknown
 *   prev 无同 id / prev 有指纹但新条目没有 → 本次新增或重绘，按当前上游补
 *
 * 老项目的已知退化：一次局部重绘时，同批复用的老条目仍保持 unknown。
 * 方向是「无法判定」而非「错误地判为新鲜」，不会造成漏判为 fresh 的静默错误。
 *
 * ── 边界 ──
 * 只补字段，不触发渲染、不改产物内容。上游产物不全时宁可不写，保持 unknown。
 */

import { applyCharacterIdentity } from './character-identity.js';
import { computeKeyframeFingerprint, computeClipFingerprint } from './fingerprint.js';

const KEYFRAME_STAGES = new Set([
  'keyframe_reference',
  'keyframe-reference',
  'keyframe',
]);
const CLIP_STAGES = new Set(['video_production', 'video-production', 'clip']);

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

function indexById(items: any[], field: string): Map<string, any> {
  const map = new Map<string, any>();
  for (const item of items) {
    const id = str(item?.[field]);
    if (id) map.set(id, item);
  }
  return map;
}

/**
 * 存量老资产复用：写入前后都没有指纹，说明它不是本次生成的，
 * 不能按当前上游补一个「看起来新鲜」的值。
 */
function isLegacyReuse(prevItem: any): boolean {
  return !!prevItem && !str(prevItem?.inputFingerprint);
}

/**
 * @param stageArtifacts 写入前的全部产物快照（不含本次要写的产物）
 * @param prev           写入前同 stage 的旧产物（用于区分复用与新增/重绘）
 * @param stage          本次要写的阶段键
 * @param artifact       本次要写入的产物（原地补齐）
 */
export function applyArtifactProvenance(
  stageArtifacts: Record<string, any> | undefined,
  prev: any,
  stage: string,
  artifact: any
): void {
  if (!artifact || typeof artifact !== 'object') return;

  // 身份补齐必须在指纹之前：storyboard 的 characterIds 是镜头指纹的输入之一。
  applyCharacterIdentity(stageArtifacts, stage, artifact);

  try {
    if (KEYFRAME_STAGES.has(stage)) {
      stampKeyframes(stageArtifacts, prev, artifact);
    } else if (CLIP_STAGES.has(stage)) {
      stampClips(stageArtifacts, prev, artifact);
    }
  } catch (err: any) {
    // 指纹只是元数据，任何异常都不能让产物落盘失败。
    console.warn(`[Provenance] 指纹补齐失败，本次资产保持 unknown: ${err?.message || '未知异常'}`);
  }
}

function stampKeyframes(
  stageArtifacts: Record<string, any> | undefined,
  prev: any,
  artifact: any
): void {
  const bible = pick(stageArtifacts, ['narrative_design', 'story_bible', 'story-bible']);
  const shots = asArray<any>(pick(stageArtifacts, ['storyboard'])?.shots);
  if (shots.length === 0) return; // 上游不全，不写指纹

  const shotsById = indexById(shots, 'shotId');
  const prevById = indexById(asArray<any>(prev?.shots), 'shotId');

  for (const kf of asArray<any>(artifact?.shots)) {
    const shotId = str(kf?.shotId);
    if (!shotId || str(kf.inputFingerprint)) continue;
    if (isLegacyReuse(prevById.get(shotId))) continue;
    const shot = shotsById.get(shotId);
    if (!shot) continue;
    kf.inputFingerprint = computeKeyframeFingerprint(bible, shot);
  }
}

function stampClips(
  stageArtifacts: Record<string, any> | undefined,
  prev: any,
  artifact: any
): void {
  const bible = pick(stageArtifacts, ['narrative_design', 'story_bible', 'story-bible']);
  const shots = asArray<any>(pick(stageArtifacts, ['storyboard'])?.shots);
  if (shots.length === 0) return;

  // 本次写的就是 clip，所以首帧产物从快照读；与 findStaleAssets 的重算口径一致。
  const keyframes = asArray<any>(
    pick(stageArtifacts, ['keyframe_reference', 'keyframe-reference', 'keyframe'])?.shots
  );
  const shotsById = indexById(shots, 'shotId');
  const keyframesByShot = indexById(keyframes, 'shotId');
  const prevById = indexById(asArray<any>(prev?.clips), 'clipId');

  for (const clip of asArray<any>(artifact?.clips)) {
    const clipId = str(clip?.clipId);
    const shotId = str(clip?.shotId);
    if (!clipId || !shotId || str(clip.inputFingerprint)) continue;
    if (isLegacyReuse(prevById.get(clipId))) continue;
    const shot = shotsById.get(shotId);
    if (!shot) continue;
    clip.inputFingerprint = computeClipFingerprint(bible, shot, keyframesByShot.get(shotId));
  }
}
