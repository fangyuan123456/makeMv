/**
 * tests/mastra/Fingerprint.test.ts
 * 上游内容指纹与陈旧判定回归
 *
 * 关键不变量：只有「真会影响画面的字段」变化才让资产变脏；
 * 老资产没有指纹时算 unknown，绝不能算 stale（否则等于一次强制全量重渲）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stableStringify,
  computeShotFingerprint,
  computeKeyframeFingerprint,
  computeClipFingerprint,
  findStaleAssets,
} from '../../src/agents/director/fingerprint.js';

const bible = () => ({
  characters: [
    { characterId: 'char_lm', name: '李明', gender: '男', age: 38, appearance: '短发，脸上有疤', visualPromptKeywords: ['硬朗'] },
    { characterId: 'char_wife', name: '李明的妻子', gender: '女', age: 36, appearance: '长发，温和' },
    { characterId: 'char_boss', name: '秘密组织首领', gender: '男', age: 55, appearance: '光头，冷峻' },
  ],
  characterNames: ['李明', '李明的妻子', '秘密组织首领'],
});

const shot = () => ({
  shotId: 'shot_1',
  nodeId: 'node_1',
  shotNumber: 1,
  shotScale: '特写',
  cameraMovement: '推',
  durationSec: 4,
  visualComposition: '雨夜，脸部反光',
  characterIds: ['char_lm'],
});

function artifacts(overrides: { keyframes?: any[]; clips?: any[]; shots?: any[]; bible?: any } = {}) {
  const b = overrides.bible || bible();
  const s = overrides.shots || [shot()];
  const kfs =
    overrides.keyframes ||
    s.map((sh: any) => ({
      shotId: sh.shotId,
      prompt: '雨夜特写，短发带疤的男人',
      imageUrl: '/img/a.png',
      inputFingerprint: computeKeyframeFingerprint(b, sh),
    }));
  const cls =
    overrides.clips ||
    s.map((sh: any) => ({
      clipId: `clip_${sh.shotId}`,
      shotId: sh.shotId,
      videoUrl: '/v/a.mp4',
      inputFingerprint: computeClipFingerprint(b, sh, kfs.find((k: any) => k.shotId === sh.shotId)),
    }));
  return {
    narrative_design: b,
    storyboard: { shots: s },
    keyframe_reference: { shots: kfs },
    video_production: { clips: cls },
  };
}

test('稳定序列化：对象键顺序不同结果一致，undefined 被忽略', () => {
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
  assert.equal(stableStringify({ a: 1, b: undefined }), stableStringify({ a: 1 }));
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]), '数组顺序是有意义的，不能排序');
});

test('运行态字段变化不改变指纹', () => {
  const s = shot();
  const base = computeShotFingerprint(bible(), s);
  const noisy = computeShotFingerprint(bible(), {
    ...s,
    status: 'rendered',
    imageUrl: '/完全不同的路径.png',
    createdAt: '2026-11-08',
    isDegraded: true,
  } as any);
  assert.equal(noisy, base, 'url / status / 时间戳不该让资产变脏');
});

test('改出镜角色的外貌 → 镜头指纹变化', () => {
  const b = bible();
  const base = computeShotFingerprint(b, shot());
  b.characters[0].appearance = '金色长发，无疤';
  assert.notEqual(computeShotFingerprint(b, shot()), base);
});

test('改未出镜角色的外貌 → 镜头指纹不变', () => {
  const b = bible();
  const base = computeShotFingerprint(b, shot());
  b.characters[2].appearance = '戴眼镜，瘦削';
  assert.equal(computeShotFingerprint(b, shot()), base, '首领不在 shot_1 出镜，改他不该重渲这个镜头');
});

test('角色数组顺序变化不改变指纹', () => {
  const b = bible();
  const s1 = { ...shot(), characterIds: ['char_lm', 'char_wife'] };
  const s2 = { ...shot(), characterIds: ['char_wife', 'char_lm'] };
  assert.equal(computeShotFingerprint(b, s1), computeShotFingerprint(b, s2));
});

test('画面字段变化 → 指纹变化', () => {
  const b = bible();
  const base = computeShotFingerprint(b, shot());
  assert.notEqual(computeShotFingerprint(b, { ...shot(), cameraMovement: '拉' }), base);
  assert.notEqual(computeShotFingerprint(b, { ...shot(), durationSec: 6 }), base);
});

test('换首帧提示词：视频片段变脏，首帧图本身不变', () => {
  const b = bible();
  const s = shot();
  assert.equal(computeClipFingerprint(b, s, { prompt: 'A' }), computeClipFingerprint(b, s, { prompt: 'A' }));
  assert.notEqual(computeClipFingerprint(b, s, { prompt: 'A' }), computeClipFingerprint(b, s, { prompt: 'B' }));
  assert.equal(
    computeKeyframeFingerprint(b, s),
    computeKeyframeFingerprint(b, s),
    '首帧指纹只依赖镜头与角色'
  );
});

test('全量一致时全部 fresh', () => {
  const r = findStaleAssets(artifacts());
  assert.equal(r.staleKeyframes.length + r.staleClips.length, 0);
  assert.equal(r.freshKeyframes.length, 1);
  assert.equal(r.freshClips.length, 1);
  assert.ok(r.summary.includes('一致'));
});

test('上游改动后精确标脏，未受影响的资产保持 fresh', () => {
  const built = artifacts({ shots: [shot(), { ...shot(), shotId: 'shot_2', shotNumber: 2, characterIds: ['char_boss'] }] });
  const changedBible = bible();
  changedBible.characters[0].appearance = '金色长发';
  const r = findStaleAssets({ ...built, narrative_design: changedBible });

  assert.deepEqual(r.staleKeyframes, ['shot_1'], '只有李明出镜的首帧变脏');
  assert.deepEqual(r.staleClips, ['clip_shot_1']);
  assert.deepEqual(r.freshKeyframes, ['shot_2']);
  assert.deepEqual(r.freshClips, ['clip_shot_2']);
});

test('老资产没有指纹 → unknown，绝不算 stale', () => {
  const built = artifacts();
  built.keyframe_reference.shots.forEach((k: any) => delete k.inputFingerprint);
  built.video_production.clips.forEach((c: any) => delete c.inputFingerprint);
  const r = findStaleAssets(built);

  assert.equal(r.staleKeyframes.length + r.staleClips.length, 0, '新机制上线不能把历史资产全标脏');
  assert.equal(r.unknownKeyframes.length, 1);
  assert.equal(r.unknownClips.length, 1);
  assert.ok(r.summary.includes('无历史指纹'));
});

test('脏数据不抛错，返回空报告', () => {
  assert.doesNotThrow(() => findStaleAssets(undefined as any));
  assert.doesNotThrow(() => findStaleAssets({ narrative_design: '坏数据' } as any));
  assert.equal(findStaleAssets(undefined as any).staleClips.length, 0);
});
