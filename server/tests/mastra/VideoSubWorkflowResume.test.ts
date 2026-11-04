/**
 * tests/mastra/VideoSubWorkflowResume.test.ts
 * 动态视频微观子工作流断点恢复 (Resume) 与单镜头靶向回退 (Single-Shot Rollback) 回归实证套件
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/index.js';
import { videoProductionTool, videoProductionSubWorkflow } from '../../src/tools/video-production/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('VideoProductionSubWorkflow 微观子工作流断点恢复与单步回退套件', () => {
  const store = ProjectStore.getInstance();
  const testProjectId = 'test_video_subwf_' + Date.now();
  let projectDir: string;

  before(() => {
    projectDir = store.getProjectDir(testProjectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    // 初始化基础工程
    store.saveProject({
      projectId: testProjectId,
      title: '赛博纪元：微观子工作流实证',
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      status: SessionStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      meta: {
        idea: '时空回溯与断点恢复',
        style: '电影质感，写实光影',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
    });

    // 挂载前置分镜资产 (3 个分镜)
    store.setArtifact(testProjectId, WorkflowStage.STORYBOARD, {
      shots: [
        { shotId: 'shot_001', prompt: '主角站在雨夜霓虹街头', durationSec: 3, cameraMovement: 'slow_pan' },
        { shotId: 'shot_002', prompt: '主角拉低风衣兜帽特写', durationSec: 4, cameraMovement: 'zoom_in' },
        { shotId: 'shot_003', prompt: '全景展示悬浮车呼啸而过', durationSec: 5, cameraMovement: 'orbit' },
      ],
    });

    // 挂载前置关键帧资产
    store.setArtifact(testProjectId, WorkflowStage.KEYFRAME_REFERENCE, {
      shots: [
        { shotId: 'shot_001', imageUrl: 'https://mock.image/shot_1.png' },
        { shotId: 'shot_002', imageUrl: 'https://mock.image/shot_2.png' },
        { shotId: 'shot_003', imageUrl: 'https://mock.image/shot_3.png' },
      ],
    });
  });

  after(() => {
    try {
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. 全量首次生成：微观子工作流能够成功并发渲染 3 个镜头并落盘', async () => {
    const res: any = await (videoProductionTool.execute as any)({
      projectId: testProjectId,
      isMock: true,
    });

    assert.equal(res.success, true);
    assert.ok(res.data);
    assert.equal(res.data.clips.length, 3);
    assert.equal(res.data.totalClips, 3);
    assert.equal(res.data.totalDurationSec, 12); // 3 + 4 + 5

    // 检查磁盘真实文件
    const videoJsonPath = path.join(projectDir, 'video', 'video_clips.json');
    assert.equal(fs.existsSync(videoJsonPath), true);
  });

  it('2. 细粒度断点恢复 (Resume & Skip)：无回退诉求时再次执行自动秒级全命中复用，绝不重复生成', async () => {
    const res: any = await (videoProductionTool.execute as any)({
      projectId: testProjectId,
      isMock: true,
    });

    assert.equal(res.success, true);
    assert.ok(res.data);
    assert.equal(res.data.clips.length, 3);
    // 摘要明确提示断点秒级全命中复用
    assert.match(res.summary, /断点秒级全命中复用/);
  });

  it('3. 单镜头靶向回退 (Single-Shot Rollback)：指定 targetShotId 仅重做指定镜头，其他镜头安全复用', async () => {
    const res: any = await (videoProductionTool.execute as any)({
      projectId: testProjectId,
      targetShotId: 'shot_002',
      userFeedback: '把兜帽特写速度放慢一倍',
      isMock: true,
    });

    assert.equal(res.success, true);
    assert.ok(res.data);
    assert.equal(res.data.clips.length, 3);
    assert.equal(res.data.isRefinement, true);
    assert.equal(res.data.targetShotId, 'shot_002');
    assert.match(res.summary, /分镜【shot_002】单镜靶向回退重绘完成/);

    // 验证镜头顺序严格保持：shot_001 -> shot_002 -> shot_003
    assert.equal(res.data.clips[0].shotId, 'shot_001');
    assert.equal(res.data.clips[1].shotId, 'shot_002');
    assert.equal(res.data.clips[2].shotId, 'shot_003');
  });

  it('4. 批量镜头靶向回退 (Multi-Shot Rollback)：指定 targetShotIds 批量重做 1 和 3，镜头 2 安全复用', async () => {
    const res: any = await (videoProductionTool.execute as any)({
      projectId: testProjectId,
      targetShotIds: ['shot_001', 'shot_003'],
      isMock: true,
    });

    assert.equal(res.success, true);
    assert.ok(res.data);
    assert.equal(res.data.clips.length, 3);
    // 断点复用了 1 支 (shot_002)，新渲染了 2 支 (shot_001, shot_003)
    assert.match(res.summary, /断点复用 1 支，新渲染 2 支/);
  });

  it('5. Mastra 官方容器直接调度：mastra.getWorkflow 能够直接调度该微观子工作流', async () => {
    const { mastra } = await import('../../src/mastra.js');
    const subwf = mastra.getWorkflow('subwf-video-production');
    assert.ok(subwf, 'subwf-video-production 应在 Mastra 实例中成功挂载');
    assert.equal(subwf.id, 'subwf-video-production');
  });
});
