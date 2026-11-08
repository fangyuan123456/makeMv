/**
 * tests/mastra/Lineage.test.ts
 * 血缘图与影响面查询回归
 *
 * 覆盖的真实事故形态：「把主角改成女性」之后，系统答不出「哪些已生成的
 * 镜头/首帧/视频要重做」，于是只能全量重算或假装没变。这里把答案固化成断言。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineage, queryImpact } from '../../src/agents/director/lineage.js';

/** 一个跑到分镜 + 首帧 + 视频的项目快照（结构取自真实项目 9gjm） */
function project(overrides: { shotCharacters?: boolean } = {}) {
  const bible = {
    characters: [
      { characterId: 'char_liming', name: '李明', role: '男主角', gender: '男', age: 38 },
      { characterId: 'char_wife', name: '李明的妻子', role: '女主角', gender: '女', age: 36 },
      { characterId: 'char_boss', name: '秘密组织首领', role: '反派BOSS', gender: '男', age: 55 },
    ],
    characterNames: ['李明', '李明的妻子', '秘密组织首领'],
    storyGraph: {
      rootNodeId: 'node_1',
      nodes: [
        { id: 'node_1', title: '灾难降临', characterNames: ['李明'] },
        { id: 'node_2', title: '家人下落', characterNames: ['李明', '李明的妻子'] },
        { id: 'node_9', title: '幕后之人', characterNames: ['秘密组织首领'] },
      ],
    },
  };

  const sceneScript = {
    scenes: [
      { nodeId: 'node_1', sceneTitle: '爆炸', dialogues: [{ speaker: '李明', line: '这是怎么回事' }] },
      { nodeId: 'node_2', sceneTitle: '回家', dialogues: [{ speaker: '李明的妻子', line: '你终于回来了' }] },
      { nodeId: 'node_9', sceneTitle: '对峙', dialogues: [{ speaker: '秘密组织首领', line: '你来晚了' }] },
    ],
  };

  const shot = (shotId: string, nodeId: string, chars?: string[]) => ({
    shotId,
    nodeId,
    shotScale: '中景',
    cameraMovement: '固定',
    durationSec: 4,
    visualComposition: '测试画面',
    ...(chars ? { characterIds: chars } : {}),
  });

  const storyboard = {
    shots: [
      shot('shot_1', 'node_1', overrides.shotCharacters ? ['李明'] : undefined),
      shot('shot_2', 'node_1', overrides.shotCharacters ? [] : undefined), // 同节点的空镜
      shot('shot_3', 'node_2', overrides.shotCharacters ? ['李明的妻子'] : undefined),
      shot('shot_4', 'node_9', overrides.shotCharacters ? ['秘密组织首领'] : undefined),
    ],
  };

  const keyframe = { shots: ['shot_1', 'shot_2', 'shot_3', 'shot_4'].map((shotId) => ({ shotId, imageUrl: 'x.png' })) };

  const clip = {
    clips: [
      { clipId: 'clip_shot_1', shotId: 'shot_1', videoUrl: 'a.mp4' },
      { clipId: 'clip_shot_2', shotId: 'shot_2', videoUrl: 'b.mp4' },
      { clipId: 'clip_shot_3', shotId: 'shot_3', videoUrl: 'c.mp4' },
      { clipId: 'clip_shot_4', shotId: 'shot_4', videoUrl: 'd.mp4' },
    ],
  };

  return {
    narrative_design: bible,
    scene_script: sceneScript,
    storyboard,
    keyframe_reference: keyframe,
    video_production: clip,
  };
}

test('节点级：改主角性别，应命中其出镜节点的全部下游资产', () => {
  const graph = buildLineage(project());
  const r = queryImpact(graph, { characters: ['李明'] });

  const shots = r.shots.map((s) => s.id).sort();
  assert.deepEqual(shots, ['shot_1', 'shot_2', 'shot_3'], 'node_1 与 node_2 都有李明，两节点的镜头都应失效');
  assert.deepEqual(r.clips.map((c) => c.id).sort(), ['clip_shot_1', 'clip_shot_2', 'clip_shot_3']);
  assert.deepEqual(r.keyframes.map((k) => k.id).sort(), ['shot_1', 'shot_2', 'shot_3']);
  assert.equal(r.usedGranularity, 'node');
  assert.ok(r.summary.includes('3 个镜头'));
});

test('节点级不会误伤其他角色的镜头', () => {
  const r = queryImpact(buildLineage(project()), { characters: ['秘密组织首领'] });
  assert.deepEqual(r.shots.map((s) => s.id), ['shot_4']);
  assert.ok(!r.shots.some((s) => s.id === 'shot_3'), '妻子的镜头不得因首领变更而失效');
});

test('镜头级：有 characterIds 时精确到镜头，不多算同节点空镜', () => {
  const graph = buildLineage(project({ shotCharacters: true }));
  assert.equal(graph.preciseShotCount, 4);

  const r = queryImpact(graph, { characters: ['李明'] });
  assert.deepEqual(r.shots.map((s) => s.id), ['shot_1'], 'shot_2 是同节点空镜、shot_3 李明不出镜，都不该被算进来');
  assert.deepEqual(r.clips.map((c) => c.id), ['clip_shot_1']);
  assert.equal(r.usedGranularity, 'shot');
});

test('改名不断链：按 characterId 改过名字后，仍能按新名定位', () => {
  const p = project({ shotCharacters: true });
  p.narrative_design.characters[0].name = '林岚'; // 改名，id 不变
  p.narrative_design.storyGraph.nodes[0].characterNames = ['林岚'];
  p.storyboard.shots[0].characterIds = ['char_liming']; // 下游仍存 id

  const r = queryImpact(buildLineage(p), { characters: ['林岚'] });
  assert.deepEqual(r.shots.map((s) => s.id), ['shot_1'], '按新名应命中，不能因为下游存的是 id 就断链');
});

test('归因链可复核：能看到 clip ← shot ← node ← 角色', () => {
  const r = queryImpact(buildLineage(project()), { characters: ['李明'] });
  const clip = r.clips.find((c) => c.id === 'clip_shot_1');
  assert.ok(clip, '应命中 clip_shot_1');
  assert.deepEqual(clip!.chain, ['clip_shot_1', 'shot_1（中景）', '灾难降临', '李明']);
});

test('按剧情节点查询：node_2 影响妻子的镜头', () => {
  const r = queryImpact(buildLineage(project()), { nodeIds: ['node_2'] });
  assert.deepEqual(r.shots.map((s) => s.id), ['shot_3']);
  assert.deepEqual(r.clips.map((c) => c.id), ['clip_shot_3']);
});

test('空查询返回空影响面，不误触发全量重算', () => {
  const r = queryImpact(buildLineage(project()), { characters: ['不存在的角色'] });
  assert.equal(r.shots.length + r.clips.length + r.keyframes.length, 0);
  assert.ok(r.summary.includes('未定位'));
});

test('产物缺失不抛错，但标记影响面不完整', () => {
  const partial = { narrative_design: project().narrative_design };
  const graph = buildLineage(partial as any);
  assert.equal(graph.missing.includes('storyboard'), true);

  const r = queryImpact(graph, { characters: ['李明'] });
  assert.equal(r.incomplete, true);
  assert.deepEqual(r.nodes.map((n) => n.id), ['node_1', 'node_2'], '没有分镜时仍能列出受影响节点');
});

test('完全空数据不崩', () => {
  const graph = buildLineage(undefined as any);
  const r = queryImpact(graph, { characters: ['李明'] });
  assert.equal(r.shots.length, 0);
  assert.equal(graph.nodes.size, 0);
});
