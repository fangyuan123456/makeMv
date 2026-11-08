/**
 * tests/mastra/Provenance.test.ts
 * 产物来源信息补齐回归套件
 *
 * 这里最值钱的一条不是「能算出指纹」，而是「绝不把旧资产伪装成新资产」：
 * 生成轨支持断点复用，cached 条目是从旧产物原样搬来的。若存储层按当前上游
 * 无条件重算指纹，该重渲的会被判成 fresh，静默漏渲比多渲危险得多。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyArtifactProvenance } from '../../src/agents/director/lineage/provenance.js';
import {
  computeKeyframeFingerprint,
  computeClipFingerprint,
  findStaleAssets,
} from '../../src/agents/director/lineage/fingerprint.js';
import { MemoryProjectStateStore } from '../../src/project-store/MemoryProjectStateStore.js';
import { SessionStatus, WorkflowStage } from '../../src/types/index.js';

const BIBLE = {
  characters: [
    { name: '李明', characterId: 'c1', gender: '男', age: 38, appearance: '短发凌乱' },
    { name: '林岚', characterId: 'c2', gender: '女', age: 30, appearance: '齐肩发' },
  ],
};

const SHOT_1 = {
  shotId: 'shot_1',
  shotNumber: 1,
  shotScale: '中景',
  durationSec: 3,
  cameraMovement: '推',
  visualComposition: '走廊尽头',
  characterIds: ['c1'],
};
const SHOT_2 = {
  shotId: 'shot_2',
  shotNumber: 2,
  shotScale: '特写',
  durationSec: 4,
  cameraMovement: '摇',
  visualComposition: '手部特写',
  characterIds: ['c2'],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function upstream(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    narrative_design: clone(BIBLE),
    storyboard: { shots: [clone(SHOT_1), clone(SHOT_2)] },
    ...overrides,
  };
}

function keyframeArtifact(items: any[]): any {
  return { shots: items, totalKeyframes: items.length, completedKeyframes: items.length };
}

function newKeyframes(): any[] {
  return [
    { shotId: 'shot_1', prompt: 'P1', imageUrl: 'a.png', status: 'rendered' },
    { shotId: 'shot_2', prompt: 'P2', imageUrl: 'b.png', status: 'rendered' },
  ];
}

describe('Provenance - 输入指纹补齐口径', () => {
  it('全新生成：所有条目补指纹，且与陈旧判定自洽（fresh）', () => {
    const sa = upstream();
    const kf = keyframeArtifact(newKeyframes());

    applyArtifactProvenance(sa, undefined, 'keyframe_reference', kf);

    assert.equal(kf.shots.length, 2);
    assert.ok(kf.shots.every((x: any) => typeof x.inputFingerprint === 'string'));
    assert.equal(kf.shots[0].inputFingerprint, computeKeyframeFingerprint(sa.narrative_design, SHOT_1));
    assert.notEqual(kf.shots[0].inputFingerprint, kf.shots[1].inputFingerprint, '不同镜头指纹必须不同');

    const report = findStaleAssets({ ...sa, keyframe_reference: kf });
    assert.deepEqual(report.freshKeyframes.sort(), ['shot_1', 'shot_2']);
    assert.deepEqual(report.staleKeyframes, []);
    assert.deepEqual(report.unknownKeyframes, []);
  });

  it('断点复用：已带指纹的旧条目绝不覆盖，上游改了要判 stale', () => {
    const sa = upstream();
    const first = keyframeArtifact(newKeyframes());
    applyArtifactProvenance(sa, undefined, 'keyframe_reference', first);
    const oldFp = first.shots[0].inputFingerprint;

    // 上游角色外貌改了，但这次是断点复用（cached 条目原样搬过来）
    const changed = upstream({
      narrative_design: {
        characters: [{ ...clone(BIBLE.characters[0]), appearance: '银白长发' }, clone(BIBLE.characters[1])],
      },
    });
    const reused = keyframeArtifact(clone(first.shots));
    applyArtifactProvenance(changed, first, 'keyframe_reference', reused);

    assert.equal(reused.shots[0].inputFingerprint, oldFp, '复用时指纹必须保留生成时的那一版');
    const report = findStaleAssets({ ...changed, keyframe_reference: reused });
    assert.deepEqual(report.staleKeyframes, ['shot_1'], '只有出镜角色被改的镜头判陈旧');
    assert.deepEqual(report.freshKeyframes, ['shot_2'], '没出镜的角色变了不该牵连别的镜头');
  });

  it('本次重绘：prev 有指纹但新条目没有，按当前上游刷新', () => {
    const sa = upstream();
    const first = keyframeArtifact(newKeyframes());
    applyArtifactProvenance(sa, undefined, 'keyframe_reference', first);

    const changed = upstream({
      narrative_design: {
        characters: [
          { ...clone(BIBLE.characters[0]), appearance: '银白长发' },
          { ...clone(BIBLE.characters[1]), appearance: '短发挑染' },
        ],
      },
    });
    // 重绘后的 shot_1 是新对象，不带指纹；shot_2 是 cached 复用
    const redrawn = clone(first.shots[0]);
    delete redrawn.inputFingerprint;
    const patched = keyframeArtifact([redrawn, clone(first.shots[1])]);
    applyArtifactProvenance(changed, first, 'keyframe_reference', patched);

    assert.notEqual(patched.shots[0].inputFingerprint, first.shots[0].inputFingerprint);
    assert.equal(patched.shots[1].inputFingerprint, first.shots[1].inputFingerprint, 'cached 条目仍保留原值');
    const report = findStaleAssets({ ...changed, keyframe_reference: patched });
    assert.deepEqual(report.freshKeyframes, ['shot_1']);
    assert.deepEqual(report.staleKeyframes, ['shot_2'], '缓存的旧图在新上游下判陈旧，符合预期');
  });

  it('老数据复用：写入前后都无指纹，保持 unknown，不伪装成 fresh', () => {
    const sa = upstream();
    const legacy = keyframeArtifact(newKeyframes()); // 老资产，没有指纹
    const reused = keyframeArtifact(clone(legacy.shots));

    applyArtifactProvenance(sa, legacy, 'keyframe_reference', reused);

    assert.equal(reused.shots[0].inputFingerprint, undefined, '存量老资产不能按当前上游补一个新鲜指纹');
    const report = findStaleAssets({ ...sa, keyframe_reference: reused });
    assert.deepEqual(report.unknownKeyframes.sort(), ['shot_1', 'shot_2']);
    assert.deepEqual(report.freshKeyframes, []);
  });

  it('上游产物不全：不写指纹，绝不基于残缺信息判定', () => {
    const sa = { narrative_design: clone(BIBLE) }; // 没有 storyboard
    const kf = keyframeArtifact(newKeyframes());

    applyArtifactProvenance(sa, undefined, 'keyframe_reference', kf);
    assert.ok(kf.shots.every((x: any) => !x.inputFingerprint));
  });

  it('clip 指纹计入首帧提示词：图换了视频必须判陈旧', () => {
    const sa = upstream();
    const kf = keyframeArtifact(newKeyframes());
    applyArtifactProvenance(sa, undefined, 'keyframe_reference', kf);
    const withKf = { ...sa, keyframe_reference: kf };

    const clips = [
      { clipId: 'clip_shot_1', shotId: 'shot_1', durationSec: 3, status: 'rendered', videoUrl: 'a.mp4' },
      { clipId: 'clip_shot_2', shotId: 'shot_2', durationSec: 4, status: 'rendered', videoUrl: 'b.mp4' },
    ];
    const clipArtifact = { clips, totalClips: 2, completedClips: 2, totalDurationSec: 7 };
    applyArtifactProvenance(withKf, undefined, 'video_production', clipArtifact);

    assert.equal(
      clips[0].inputFingerprint,
      computeClipFingerprint(sa.narrative_design, SHOT_1, kf.shots[0])
    );
    let report = findStaleAssets({ ...withKf, video_production: clipArtifact });
    assert.deepEqual(report.staleClips, []);

    kf.shots[0].prompt = 'P1-重绘后的新提示词';
    report = findStaleAssets({ ...withKf, video_production: clipArtifact });
    assert.deepEqual(report.staleClips, ['clip_shot_1'], '首帧图换了，依赖它的视频必须重做');
    assert.deepEqual(report.staleClips.length, 1);
  });

  it('包装后角色身份补齐仍然生效（回归）', () => {
    const sa: Record<string, any> = {};
    const bible: any = { characters: [{ name: '李明' }, { name: '林岚' }] };
    applyArtifactProvenance(sa, undefined, 'narrative_design', bible);
    assert.ok(bible.characters.every((c: any) => typeof c.characterId === 'string'));
  });

  it('MemoryProjectStateStore 接线：走 setArtifact 也能补上指纹', () => {
    const store = new MemoryProjectStateStore();
    const projectId = 'test_proj_provenance_store';
    store.saveProject({
      projectId,
      title: '指纹接线测试',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
    } as any);

    store.setArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN, clone(BIBLE));
    store.setArtifact(projectId, WorkflowStage.STORYBOARD, {
      shots: [clone(SHOT_1), clone(SHOT_2)],
    });
    const kf = keyframeArtifact(newKeyframes());
    store.setArtifact(projectId, WorkflowStage.KEYFRAME_REFERENCE, kf);

    assert.ok(kf.shots.every((x: any) => typeof x.inputFingerprint === 'string'));
    const artifacts = store.getProject(projectId)!.stageArtifacts!;
    assert.deepEqual(findStaleAssets(artifacts).freshKeyframes.sort(), ['shot_1', 'shot_2']);
  });
});
