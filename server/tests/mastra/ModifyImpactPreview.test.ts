/**
 * tests/mastra/ModifyImpactPreview.test.ts
 * 待确认卡片影响面回归
 *
 * 核心不变量：影响面是「算」出来的，不是模型猜的；识别不出变更对象时
 * 宁可不展示，也不能给一个看起来有数的全量估算——重渲要花真钱。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  previewModifyImpact,
  resolveImpactTargets,
} from '../../src/agents/director/modifier/impact.js';

function project() {
  const bible = {
    characters: [
      { characterId: 'char_liming', name: '李明', role: '男主角', gender: '男' },
      { characterId: 'char_wife', name: '李明的妻子', role: '女主角', gender: '女' },
      { characterId: 'char_boss', name: '秘密组织首领', role: '反派BOSS', gender: '男' },
    ],
    characterNames: ['李明', '李明的妻子', '秘密组织首领'],
    storyGraph: {
      nodes: [
        { id: 'node_1', title: '灾难降临', characterNames: ['李明'] },
        { id: 'node_2', title: '寻找家人', characterNames: ['李明', '李明的妻子'] },
        { id: 'node_9', title: '幕后之人', characterNames: ['秘密组织首领'] },
      ],
    },
  };

  return {
    narrative_design: bible,
    scene_script: {
      scenes: [
        { nodeId: 'node_1', sceneTitle: '爆炸', dialogues: [{ speaker: '李明', line: '出事了' }] },
        { nodeId: 'node_2', sceneTitle: '回家', dialogues: [{ speaker: '李明的妻子', line: '你回来了' }] },
      ],
    },
    storyboard: {
      shots: [
        { shotId: 'shot_1', nodeId: 'node_1', characterNames: ['李明'] },
        { shotId: 'shot_2', nodeId: 'node_1', characterNames: [] },
        { shotId: 'shot_3', nodeId: 'node_2', characterNames: ['李明的妻子'] },
        { shotId: 'shot_4', nodeId: 'node_9', characterNames: ['秘密组织首领'] },
      ],
    },
    keyframe_reference: {
      shots: ['shot_1', 'shot_2', 'shot_3', 'shot_4'].map((shotId) => ({ shotId, imageUrl: 'x.png' })),
    },
    video_production: {
      clips: [
        { clipId: 'clip_shot_1', shotId: 'shot_1' },
        { clipId: 'clip_shot_3', shotId: 'shot_3' },
        { clipId: 'clip_shot_4', shotId: 'shot_4' },
      ],
    },
  };
}

test('识别角色：长名优先，不被短名抢先命中', () => {
  const t = resolveImpactTargets(project(), '把李明的妻子删掉');
  assert.deepEqual(t.characters, ['李明的妻子'], '应取完整角色名，不是「李明」');
  assert.deepEqual(t.labels, ['李明的妻子']);
});

test('识别不点名指令：按剧情节点出场频次认领主角', () => {
  const t = resolveImpactTargets(project(), '把主角改成女的');
  assert.deepEqual(t.characters, ['李明']);
  assert.deepEqual(t.labels, ['主角（李明）']);
});

test('出场频次并列时不敢猜，返回空', () => {
  const p = project();
  p.narrative_design.storyGraph.nodes = [
    { id: 'node_1', title: '灾难降临', characterNames: ['李明'] },
    { id: 'node_2', title: '寻找家人', characterNames: ['李明的妻子'] },
  ];
  const t = resolveImpactTargets(p, '把主角改成女的');
  assert.equal(t.characters.length, 0, '两人出场一样多，认领谁都是猜');
});

test('识别 node / shot 编号', () => {
  const t = resolveImpactTargets(project(), 'node_2 的 shot_3 换成特写');
  assert.deepEqual(t.nodeIds, ['node_2']);
  assert.deepEqual(t.shotIds, ['shot_3']);
});

test('影响面计数与归因链可复核', () => {
  const r = previewModifyImpact(project(), '把李明的妻子去掉');
  assert.ok(r);
  assert.deepEqual(r!.targets, ['李明的妻子']);
  assert.equal(r!.granularity, 'shot');
  assert.equal(r!.counts.shots, 1, '只有 shot_3 是她出镜');
  assert.equal(r!.counts.clips, 1);
  assert.equal(r!.counts.keyframes, 1);
  assert.ok(r!.summary.includes('1 个镜头'));
  assert.ok(r!.samples.some((s) => s.id === 'clip_shot_3'));
  assert.ok(r!.samples.every((s) => s.chain.includes('李明的妻子')), '每条归因链都要能回溯到改动对象');
});

test('主角变更：精确挂靠下只命中他本人出镜的镜头', () => {
  const r = previewModifyImpact(project(), '把主角改成女的');
  assert.ok(r);
  assert.equal(r!.counts.shots, 1, 'shot_1 出镜；shot_2 是空镜、shot_3 只有妻子');
});

test('识别不出变更对象时不展示影响面', () => {
  assert.equal(previewModifyImpact(project(), '整体节奏再快一点'), null);
  assert.equal(previewModifyImpact(project(), ''), null);
});

test('未完成项目：识别到对象但无下游资产，如实说明', () => {
  const partial = { narrative_design: project().narrative_design };
  const r = previewModifyImpact(partial, '把李明改成女性');
  assert.ok(r);
  assert.equal(r!.counts.shots + r!.counts.clips, 0);
  assert.equal(r!.incomplete, true);
  assert.ok(r!.summary.includes('暂不需要重做'));
});

test('脏数据不抛错、不阻断修改任务派发', () => {
  assert.equal(previewModifyImpact(undefined, '把李明改成女性'), null);
  assert.equal(previewModifyImpact({ narrative_design: '坏数据' } as any, '把李明改成女性'), null);
});
