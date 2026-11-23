import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import {
  computeProjectStaleMap,
  recordShotKeyframeUpdated,
  recordShotPromptUpdated,
} from '../src/project-store/freshness.js';

test('🎬 验证分镜提示词修改 ➔ 关键帧脏数据标记与自动解除全链路闭环', async (t) => {
  const store = ProjectStore.getInstance();
  const projectId = 'test_stale_lineage_proj_001';
  const projectDir = store.getProjectDir(projectId);

  // 清理测试目录
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  fs.mkdirSync(projectDir, { recursive: true });

  const mockStoryboards = [
    {
      clipId: 'c1',
      shots: [
        {
          shotId: 'c1-01',
          firstFramePrompt: '旧提示词：站立于舰桥的军官',
          videoPrompt: '缓推镜头',
          keyframeUrl: '/media/test/c1-01_first.png',
          firstFrameImageUrl: '/media/test/c1-01_first.png',
        },
      ],
    },
  ];

  store.setArtifact(projectId, 'storyboards', mockStoryboards);

  await t.test('1. 初始化：关键帧已出图，当前上下游状态对齐无脏标记', () => {
    // 模拟之前已生成首帧关键帧
    recordShotKeyframeUpdated(projectId, 'c1-01', 'first');
    const staleMap = computeProjectStaleMap(projectId);
    assert.equal(staleMap.shotKeyframes['c1-01'], undefined, '初始状态关键帧应无脏标记');
  });

  await t.test('2. 提示词修改后：关键帧自动标记为脏数据（Stale），原因包含提示词已修改', async () => {
    // 模拟一小段延时确保时间戳递增
    await new Promise((r) => setTimeout(r, 10));

    // 用户/工具执行了提示词定向修改（提示词文本发生实质变更）
    const newPrompt = '新修改的提示词：坐于舰桥控制台前的军官，面色冷峻';
    mockStoryboards[0].shots[0].firstFramePrompt = newPrompt;
    store.setArtifact(projectId, 'storyboards', mockStoryboards);
    recordShotPromptUpdated(projectId, ['c1-01'], { 'c1-01': newPrompt });

    const staleMap = computeProjectStaleMap(projectId);
    const kfStale = staleMap.shotKeyframes['c1-01'];

    assert.ok(kfStale, '提示词更新后，已有关键帧必须被标记为脏数据');
    assert.match(
      kfStale.reason,
      /镜头视听提示词已修改，建议重新渲染首帧关键帧/,
      '脏标记原因应清晰指示由于提示词更新，建议重新渲染首帧'
    );
  });

  await t.test('3. 重新渲染关键帧后：脏数据标记自动解除恢复收敛', async () => {
    await new Promise((r) => setTimeout(r, 10));

    // 执行了重新渲染首帧
    recordShotKeyframeUpdated(projectId, 'c1-01', 'first');

    const staleMap = computeProjectStaleMap(projectId);
    assert.equal(staleMap.shotKeyframes['c1-01'], undefined, '重新渲染后关键帧脏标记应被彻底清除');
  });

  // 清理测试目录
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
