/**
 * mastra/FmvPackagingTool.test.ts
 * 互动影游母带装配与打包工具测试套件
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { fmvPackagingTool } from '../../src/mastra/tools/fmv-packaging/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('FmvPackagingTool - 互动母带装配与打包工具测试套件', () => {
  const testProjectId = 'test_fmv_pkg_proj';
  const store = ProjectStore.getInstance();
  const testProjectDir = store.getProjectDir(testProjectId);

  beforeEach(() => {
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '迷雾侦探：致命抉择',
      currentStage: WorkflowStage.VIDEO_PRODUCTION,
      status: SessionStatus.RUNNING,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '致命侦探案情',
        style: '黑色电影悬疑调色',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });

    // 1. 预置叙事拓扑设计
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '迷雾侦探：致命抉择',
      storyGraph: {
        rootNodeId: 'node_1',
        endingsCount: 1,
        nodes: [
          {
            id: 'node_1',
            title: '雨夜案发现场',
            isEnding: false,
            choices: [
              { targetNodeId: 'node_2', text: '检查受害者口袋' },
              { targetNodeId: 'node_3', text: '追赶可疑黑影' },
            ],
          },
          {
            id: 'node_2',
            title: '发现隐藏芯片',
            isEnding: true,
            choices: [],
          },
          {
            id: 'node_3',
            title: '遭遇伏击真相大白',
            isEnding: true,
            choices: [],
          },
        ],
      },
    });

    // 2. 预置视听分镜（绑定 shotId -> nodeId）
    store.setArtifact(testProjectId, WorkflowStage.STORYBOARD, {
      shots: [
        { shotId: 'shot_1', nodeId: 'node_1', shotNumber: 1 },
        { shotId: 'shot_2', nodeId: 'node_2', shotNumber: 2 },
        { shotId: 'shot_3', nodeId: 'node_3', shotNumber: 3 },
      ],
    });

    // 3. 预置已渲染的视频切片
    store.setArtifact(testProjectId, WorkflowStage.VIDEO_PRODUCTION, {
      clips: [
        { clipId: 'clip_1', shotId: 'shot_1', videoUrl: '/media/test/clip_1.mp4', durationSec: 8 },
        { clipId: 'clip_2', shotId: 'shot_2', videoUrl: '/media/test/clip_2.mp4', durationSec: 6 },
        { clipId: 'clip_3', shotId: 'shot_3', videoUrl: '/media/test/clip_3.mp4', durationSec: 10 },
      ],
    });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testProjectDir)) {
        fs.rmSync(testProjectDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. 应成功装配母带 Manifest 并落盘本地文件与状态黑板', async () => {
    const res = await (fmvPackagingTool.execute as any)({
      projectId: testProjectId,
      userFeedback: '高品质打包',
    });

    assert.equal(res.success, true);
    assert.ok(res.artifact);
    assert.equal(res.artifact.title, '迷雾侦探：致命抉择');
    assert.equal(res.artifact.totalNodes, 3);
    assert.equal(res.artifact.totalClips, 3);
    assert.equal(res.artifact.totalEndings, 2);
    assert.equal(res.artifact.playableDurationSec, 24); // 8 + 6 + 10 = 24
    assert.equal(res.artifact.status, 'packaged');

    // 验证 FMVManifest 节点结构
    const manifest = res.artifact.fmvManifest;
    assert.ok(manifest.nodes['node_1']);
    assert.equal(manifest.nodes['node_1'].isDecisionPoint, true);
    assert.equal(manifest.nodes['node_1'].choices?.length, 2);
    assert.equal(manifest.nodes['node_2'].isDecisionPoint, false);

    // 验证本地物理文件 package/game-manifest.json 真实存在
    const manifestPath = path.join(testProjectDir, 'package', 'game-manifest.json');
    assert.ok(fs.existsSync(manifestPath), '物理 manifest 文件必须存在');

    // 验证 ProjectStore 状态黑板产物落盘
    const savedArtifact = store.getArtifact(testProjectId, WorkflowStage.FMV_PACKAGING);
    assert.ok(savedArtifact, '母带产物必须成功保存至 ProjectStore 黑板');

    // 遵循法典微内核契约：底层工具严禁越权推进项目状态，生命周期推进权由编排层/确认层统筹收拢
    const savedProject = store.getProject(testProjectId);
    assert.equal(savedProject?.currentStage, WorkflowStage.VIDEO_PRODUCTION, '工具执行不得越权篡改 currentStage');
  });

  it('2. 视频切片 clips 为空时应刚性阻断，拒绝假装配', async () => {
    store.setArtifact(testProjectId, WorkflowStage.VIDEO_PRODUCTION, { clips: [] });

    await assert.rejects(
      async () => {
        await (fmvPackagingTool.execute as any)({
          projectId: testProjectId,
        });
      },
      /未检索到已渲染完成的视频切片/
    );
  });
});
