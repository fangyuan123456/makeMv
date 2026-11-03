import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { VideoProductionSkill } from '../../skills/video-production/VideoProductionSkill.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';

describe('VideoProductionSkill 动态视频切片生成技能', () => {
  const store = ProjectStore.getInstance();
  const videoSkill = new VideoProductionSkill();
  const testProjectId = 'test_proj_video_prod';

  before(() => {
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '命运齿轮',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.VIDEO_PRODUCTION,
      stageArtifacts: {},
      history: [],
      meta: { idea: '蒸汽朋克', style: '复古蒸汽朋克', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('缺少前序关键帧数据时刚性 Fail-Fast 阻断', async () => {
    const res = await videoSkill.execute({
      projectId: testProjectId,
      params: { isMock: true },
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /缺少前序关键帧数据/);
  });

  it('全量批量渲染动态视频切片，绑定机位时长与分辨率', async () => {
    // 注入 Stage 4 STORYBOARD 与 Stage 5 KEYFRAME_REFERENCE 资产
    store.setArtifact(testProjectId, WorkflowStage.STORYBOARD, {
      shots: [
        { shotId: 'shot_1', durationSec: 4, visualComposition: '怀表特写' },
        { shotId: 'shot_2', durationSec: 5, visualComposition: '雷恩抬头' },
      ],
    });

    store.setArtifact(testProjectId, WorkflowStage.KEYFRAME_REFERENCE, {
      shots: [
        { shotId: 'shot_1', imageUrl: '/media/test/shot_1.jpg', prompt: '怀表特写' },
        { shotId: 'shot_2', imageUrl: '/media/test/shot_2.jpg', prompt: '雷恩抬头' },
      ],
    });

    const res = await videoSkill.execute({
      projectId: testProjectId,
      params: { isMock: true },
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.totalClips, 2);
      assert.equal(artifact.clips.length, 2);
      assert.equal(artifact.clips[0].shotId, 'shot_1');
      assert.equal(artifact.clips[0].durationSec, 4);
      assert.ok(artifact.clips[0].videoUrl);
      assert.equal(artifact.clips[1].shotId, 'shot_2');
      assert.equal(artifact.clips[1].durationSec, 5);

      // 验证状态黑板落盘
      const saved = store.getArtifact<any>(testProjectId, WorkflowStage.VIDEO_PRODUCTION);
      assert.ok(saved);
      assert.equal(saved.totalClips, 2);
    }
  });

  it('单镜头靶向微调：指定 targetShotId 仅重做该切片并保留其他切片', async () => {
    const res = await videoSkill.execute({
      projectId: testProjectId,
      params: {
        targetShotId: 'shot_1',
        userFeedback: '镜头微推更平稳',
        isMock: true,
      },
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.totalClips, 2);
      const clip1 = artifact.clips.find((c) => c.shotId === 'shot_1');
      const clip2 = artifact.clips.find((c) => c.shotId === 'shot_2');

      assert.ok(clip1);
      assert.ok(clip2);
      assert.equal(clip2.shotId, 'shot_2');
    }
  });

  it('指定不存在的 targetShotId 时阻断报错', async () => {
    const res = await videoSkill.execute({
      projectId: testProjectId,
      params: {
        targetShotId: 'shot_999_none',
        isMock: true,
      },
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /未在关键帧资产中找到指定渲染的目标镜头/);
  });

  it('无既有视频资产时指定 targetShotId 刚性 Fail-Fast 报错', async () => {
    const emptyProjId = 'test_proj_video_empty_artifact';
    store.saveProject({
      projectId: emptyProjId,
      title: '空视频资产项目',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.VIDEO_PRODUCTION,
      stageArtifacts: {},
      history: [],
      meta: { idea: '测试', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    store.setArtifact(emptyProjId, WorkflowStage.KEYFRAME_REFERENCE, {
      totalKeyframes: 1,
      shots: [
        { shotId: 'shot_1', shotNumber: 1, prompt: '首帧图', imageUrl: '/media/test.jpg' },
      ],
    });

    const res = await videoSkill.execute({
      projectId: emptyProjId,
      params: {
        targetShotId: 'shot_1',
        isMock: true,
      },
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /当前项目尚无既有视频切片资产/);
  });
});
