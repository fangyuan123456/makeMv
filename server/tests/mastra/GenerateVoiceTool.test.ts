/**
 * tests/mastra/GenerateVoiceTool.test.ts
 * 原子配音物理工具与角色全局音色 (Voice Generate Tool SSOT) 单元测试套件
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { ProjectStore } from '../../src/project-store/index.js';
import { voiceGenerateTool } from '../../src/tools/voice-generate/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('VoiceGenerateTool - 原子台词物理配音工具测试套件', () => {
  const testProjectId = 'test_voice_proj_01';
  const store = ProjectStore.getInstance();
  const testProjectDir = store.getProjectDir(testProjectId);

  beforeEach(() => {
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '迷雾侦探：午夜回响',
      currentStage: WorkflowStage.SCENE_SCRIPT,
      status: SessionStatus.IDLE,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '侦探调查失踪的歌剧名伶',
        style: '黑色电影，胶片质感',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testProjectDir)) {
        fs.rmSync(testProjectDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. 应成功生成单句台词配音并计算时长', async () => {
    const result: any = await (voiceGenerateTool.execute as any)({
      projectId: testProjectId,
      segmentId: 'seg_sc1_01',
      text: '当暴风雨降临在泰晤士河畔，没有人能全身而退。',
      rate: 1.0,
      emotion: 'resolute',
      isMock: true,
    });

    assert.equal(result.success, true);
    assert.ok(result.audioUrl);
    assert.ok(result.durationSec > 0);
  });

  it('2. 缺失入参时应安全拦截并返回错误信息', async () => {
    const result: any = await (voiceGenerateTool.execute as any)({
      projectId: testProjectId,
      segmentId: '',
      text: '',
      isMock: true,
    });

    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});
