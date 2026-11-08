/**
 * tests/mastra/RecomputePlan.test.ts
 * 增量重算清单（dry-run）回归套件
 *
 * 锁住的口径：
 *   1. 影响面 ∩ 陈旧 才是本次该重做的，其余单列，绝不混进执行清单；
 *   2. 首帧图重做 → 视频必须跟着重做（传递依赖不能漏）；
 *   3. 老数据无指纹只进 unknown，由人确认，不自动花钱；
 *   4. 没配单价就只给数量与秒数，不编金额；
 *   5. 全程不触发渲染（本模块没有任何写盘/调用渲染器的入口）。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecomputePlan,
  formatRecomputePlan,
} from '../../src/agents/director/recompute-plan.js';
import {
  computeKeyframeFingerprint,
  computeClipFingerprint,
} from '../../src/agents/director/fingerprint.js';
import type { ImpactResult } from '../../src/agents/director/lineage.js';

const BIBLE = {
  characters: [{ name: '李明', characterId: 'c1', gender: '男', age: 38, appearance: '短发' }],
  storyGraph: {
    nodes: [{ nodeId: 'node_1', title: '灾难降临', characterNames: ['李明'] }],
  },
};

const SHOTS = [
  { shotId: 'shot_1', nodeId: 'node_1', shotNumber: 1, shotScale: '中景', durationSec: 3, characterIds: ['c1'] },
  { shotId: 'shot_2', nodeId: 'node_1', shotNumber: 2, shotScale: '特写', durationSec: 4, characterIds: ['c1'] },
];

interface FixtureOptions {
  staleShots?: string[];
  staleClips?: string[];
  unknownShots?: string[];
  unknownClips?: string[];
}

function project(opts: FixtureOptions = {}): Record<string, any> {
  const kfs = SHOTS.map((s) => {
    const value = opts.unknownShots?.includes(s.shotId)
      ? undefined
      : opts.staleShots?.includes(s.shotId)
        ? 'OLD_KEYFRAME'
        : computeKeyframeFingerprint(BIBLE, s);
    return {
      shotId: s.shotId,
      prompt: `P_${s.shotId}`,
      imageUrl: `${s.shotId}.png`,
      status: 'rendered',
      inputFingerprint: value,
    };
  });
  const clips = SHOTS.map((s) => {
    const value = opts.unknownClips?.includes(`clip_${s.shotId}`)
      ? undefined
      : opts.staleClips?.includes(`clip_${s.shotId}`)
        ? 'OLD_CLIP'
        : computeClipFingerprint(BIBLE, s, kfs.find((k) => k.shotId === s.shotId));
    return {
      clipId: `clip_${s.shotId}`,
      shotId: s.shotId,
      durationSec: s.durationSec,
      status: 'rendered',
      videoUrl: `${s.shotId}.mp4`,
      inputFingerprint: value,
    };
  });
  return {
    narrative_design: JSON.parse(JSON.stringify(BIBLE)),
    storyboard: { shots: JSON.parse(JSON.stringify(SHOTS)) },
    keyframe_reference: { shots: kfs },
    video_production: { clips },
  };
}

function impactOf(shotIds: string[], overrides: Partial<ImpactResult> = {}): ImpactResult {
  return {
    characters: [],
    nodes: [],
    scenes: [],
    shots: shotIds.map((id) => ({ id, chain: [`${id} 中景`, '灾难降临', '李明'] })),
    keyframes: [],
    clips: [],
    incomplete: false,
    missing: [],
    usedGranularity: 'shot',
    summary: '',
    ...overrides,
  };
}

describe('RecomputePlan - dry-run 增量重算清单', () => {
  it('无改动：清单为空，格式化明确写「无需重做」', () => {
    const plan = buildRecomputePlan(project());
    assert.equal(plan.items.length, 0);
    assert.equal(plan.counts.keyframes, 0);
    assert.ok(plan.summary.includes('0 项待重做'));
    assert.ok(formatRecomputePlan(plan).includes('无需重做'));
  });

  it('全项目模式：所有陈旧项都进清单，按波次排序', () => {
    const plan = buildRecomputePlan(project({ staleShots: ['shot_1'], staleClips: ['clip_shot_2'] }));
    assert.deepEqual(
      plan.items.map((i) => `${i.wave}:${i.id}`),
      ['1:shot_1', '2:clip_shot_1', '2:clip_shot_2']
    );
    assert.equal(plan.counts.keyframes, 1);
    assert.equal(plan.counts.clips, 2);
    assert.equal(plan.estimate.videoSeconds, 7);
    assert.equal(plan.estimate.costConfigured, false);
    assert.equal(plan.estimate.cost, undefined, '未配单价绝不能编金额');
    assert.ok(plan.warnings.some((w) => w.includes('未配置单价')));
  });

  it('影响面交集：只重做归因到本次改动的资产，其余单列', () => {
    const plan = buildRecomputePlan(
      project({ staleShots: ['shot_1', 'shot_2'], staleClips: ['clip_shot_1', 'clip_shot_2'] }),
      { impact: impactOf(['shot_1']) }
    );

    assert.ok(plan.items.every((i) => i.shotId === 'shot_1'), 'shot_2 的陈旧不该混进本次清单');
    assert.deepEqual(plan.otherStale.map((i) => i.id).sort(), ['clip_shot_2', 'shot_2']);
    assert.ok(plan.otherStale.every((i) => i.reason === 'stale-outside-impact'));
    assert.ok(plan.warnings.some((w) => w.includes('历史遗留')));
    assert.equal(plan.usedGranularity, 'shot');
  });

  it('传递依赖：首帧图重做但视频指纹没变，视频仍必须重做', () => {
    const plan = buildRecomputePlan(project({ staleShots: ['shot_1'] }));
    const clip = plan.items.find((i) => i.id === 'clip_shot_1');
    assert.ok(clip, '依赖首帧图的视频必须进清单');
    assert.equal(clip!.reason, 'depends-on-keyframe');
    assert.equal(clip!.wave, 2);
    assert.equal(clip!.durationSec, 3);
  });

  it('老数据：命中影响面但无指纹，只进 unknown，由人确认', () => {
    const plan = buildRecomputePlan(project({ unknownShots: ['shot_1'], unknownClips: ['clip_shot_1'] }), {
      impact: impactOf(['shot_1']),
    });
    assert.equal(plan.items.length, 0, '无法判定的资产绝不自动执行');
    assert.deepEqual(plan.unknown.map((i) => i.id).sort(), ['clip_shot_1', 'shot_1']);
    assert.ok(plan.warnings.some((w) => w.includes('需人工确认')));
  });

  it('配置单价后给出金额与逐项估算', () => {
    const plan = buildRecomputePlan(project({ staleShots: ['shot_1'] }), {
      pricing: { keyframePerUnit: 0.5, videoPerSecond: 2 },
    });
    // 1 张图 0.5 + 1 段 3 秒视频 6 = 6.5
    assert.equal(plan.estimate.cost, 6.5);
    assert.equal(plan.estimate.currency, '¥');
    const kf = plan.items.find((i) => i.kind === 'keyframe')!;
    const clip = plan.items.find((i) => i.kind === 'clip')!;
    assert.equal(kf.estimatedCost, 0.5);
    assert.equal(clip.estimatedCost, 6);
    assert.ok(plan.summary.includes('预估 ¥6.50'));
  });

  it('影响面数据不完整或按节点粗算时，警告必须原样带出', () => {
    const plan = buildRecomputePlan(project({ staleShots: ['shot_1'] }), {
      impact: impactOf(['shot_1'], {
        incomplete: true,
        missing: ['scene-script'],
        usedGranularity: 'node',
      }),
    });
    assert.ok(plan.warnings.some((w) => w.includes('scene-script')));
    assert.ok(plan.warnings.some((w) => w.includes('粗算')));
  });

  it('query 路径：能从血缘图现算影响面并落到清单', () => {
    const plan = buildRecomputePlan(
      project({ staleShots: ['shot_1'], staleClips: ['clip_shot_1', 'clip_shot_2'] }),
      { query: { shotIds: ['shot_1'] } }
    );
    assert.ok(plan.items.length > 0);
    assert.ok(plan.items.every((i) => i.shotId === 'shot_1'));
    assert.equal(plan.usedGranularity, 'shot');
  });

  it('格式化输出包含波次、归因链与警告，可直接给人过目', () => {
    const plan = buildRecomputePlan(project({ staleShots: ['shot_1'] }), {
      impact: impactOf(['shot_1']),
    });
    const text = formatRecomputePlan(plan);
    assert.ok(text.includes('dry-run'));
    assert.ok(text.includes('[W1 首帧图]'));
    assert.ok(text.includes('[W2 视频]'));
    assert.ok(text.includes('归因：'));
    assert.ok(text.includes('李明'));
    assert.ok(text.includes('⚠'));
  });
});
