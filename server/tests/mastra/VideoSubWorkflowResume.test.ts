/**
 * tests/mastra/VideoSubWorkflowResume.test.ts
 * 动态视频微观子工作流断点恢复 (Resume) 与定向调优 (Modifier) 回归实证套件
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/index.js';
import { videoProductionSubWorkflow } from '../../src/agents/director/generator/steps/video-production/index.js';
import { modifyVideoClip } from '../../src/agents/director/modifier/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('VideoProductionSubWorkflow 微观子工作流断点恢复与定向精修套件', () => {
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
      status: SessionStatus.RUNNING,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stageArtifacts: {},
      history: [],
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
    const run = await (videoProductionSubWorkflow as any).createRun();
    const runResult = await run.start({
      inputData: {
        projectId: testProjectId,
        isMock: true,
      },
    });
    const res = runResult?.result || runResult;

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
    const run = await (videoProductionSubWorkflow as any).createRun();
    const runResult = await run.start({
      inputData: {
        projectId: testProjectId,
        isMock: true,
      },
    });
    const res = runResult?.result || runResult;

    assert.equal(res.success, true);
    assert.ok(res.data);
    assert.equal(res.data.clips.length, 3);
    assert.match(res.summary, /断点秒级全命中复用/);
  });

  it('3. Mastra 官方容器直接调度：mastra.getWorkflow 能够直接调度该微观子工作流', async () => {
    const { mastra } = await import('../../src/mastra.js');
    const subwf = mastra.getWorkflow('subwf-video-production');
    assert.ok(subwf, 'subwf-video-production 应在 Mastra 实例中成功挂载');
    assert.equal(subwf.id, 'subwf-video-production');
  });

  it('4. 精修智能体修改器：modifyVideoClip 支持动作姿态时序解构与角色提示词穿透', async () => {
    const clip = await modifyVideoClip({
      projectId: testProjectId,
      kf: { shotId: 'shot_002', imageUrl: 'https://mock.image/shot_2.png' },
      sbShot: { shotId: 'shot_002', durationSec: 4, cameraMovement: 'zoom_in', subjectMotion: '反手拔刀' },
      actionRevision: true,
      userFeedback: '主角迅速反手拔出腰间光刃，在空中挽出刀花定格',
      characterPrompt: '银色短发赛博义体女侦探，身着暗色防弹大衣',
      isMock: true,
    });

    assert.ok(clip);
    assert.equal(clip.shotId, 'shot_002');
    assert.equal(clip.renderMode, 'pose_breakdown');
    assert.equal(clip.characterPrompt, '银色短发赛博义体女侦探，身着暗色防弹大衣');
    assert.ok(Array.isArray(clip.keyPoses));
    assert.ok(clip.keyPoses.length >= 2, '动作解构应生成至少 2 个关键动作姿态卡点');
    assert.ok(clip.keyPoses[0].poseName);
  });
});
