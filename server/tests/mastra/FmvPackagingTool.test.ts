/**
 * mastra/FmvPackagingTool.test.ts
 * 互动影游母带装配与打包工序测试套件
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { executeFmvPackaging, compileFmvManifest } from '../../src/agents/director/generator/steps/fmv-packaging/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('FmvPackagingStep - 互动母带装配与打包工序测试套件', () => {
  const testProjectId = 'test_fmv_pkg_proj';
  const store = ProjectStore.getInstance();
  const testProjectDir = store.getProjectDir(testProjectId);

  beforeEach(() => {
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '迷雾侦探：致命抉择',
      currentStage: WorkflowStage.FMV_PACKAGING,
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
        endingsCount: 2,
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
    const res = await executeFmvPackaging({
      projectId: testProjectId,
      overrideParams: {
        title: '迷雾侦探：致命抉择',
      },
    });

    assert.ok(res.toolResult);
    const manifest = res.toolResult;
    assert.equal(manifest.gameTitle, '迷雾侦探：致命抉择');
    assert.ok(manifest.nodes['node_1']);
    assert.equal(manifest.nodes['node_1'].isDecisionPoint, true);
    assert.equal(manifest.nodes['node_1'].choices?.length, 2);
    assert.equal(manifest.nodes['node_2'].isDecisionPoint, false);

    // 验证 ProjectStore 状态黑板产物落盘
    const savedArtifact = store.getArtifact(testProjectId, WorkflowStage.FMV_PACKAGING);
    assert.ok(savedArtifact, '母带产物必须成功保存至 ProjectStore 黑板');
  });

  it('2. compileFmvManifest 能正确基于视频切片与分镜映射拓扑结构', () => {
    const compiled = compileFmvManifest({
      gameTitle: '单元测试影游',
      rawNodes: [
        { id: 'n1', title: '起点', choices: [{ targetNodeId: 'n2', text: '前往终点' }] },
        { id: 'n2', title: '终点', isEnding: true, choices: [] },
      ],
      storyboardShots: [
        { shotId: 's1', nodeId: 'n1' },
        { shotId: 's2', nodeId: 'n2' },
      ],
      clips: [
        { clipId: 'c1', shotId: 's1', videoUrl: '/video/1.mp4', durationSec: 5 },
        { clipId: 'c2', shotId: 's2', videoUrl: '/video/2.mp4', durationSec: 5 },
      ],
    });

    assert.equal(compiled.fmvManifest.gameTitle, '单元测试影游');
    assert.equal(compiled.totalEndings, 1);
    assert.equal(compiled.totalDurationSec, 10);
    assert.equal(compiled.isDegraded, false);
  });
});
