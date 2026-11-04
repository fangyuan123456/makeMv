/**
 * tests/mastra/GenerateVoiceTool.test.ts
 * 原子配音工具与角色全局音色锁 (Generate Voice Tool SSOT) 单元测试套件
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/index.js';
import { generateVoiceTool } from '../../src/tools/voice-production/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { config } from '../../src/utils/config.js';

describe('GenerateVoiceTool - 原子台词配音工具与全局音色锁测试套件', () => {
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

  it('1. 应成功生成单句台词配音并初次锁定角色音色', async () => {
    const result: any = await (generateVoiceTool.execute as any)({
      projectId: testProjectId,
      segmentId: 'seg_sc1_01',
      sceneId: 'scene_1',
      speaker: '霍尔莫斯',
      text: '当暴风雨降临在泰晤士河畔，没有人能全身而退。',
      rate: 1.0,
      emotion: 'resolute',
      isMock: true,
    });

    assert.equal(result.success, true);
    assert.ok(result.segment);
    assert.equal(result.segment.segmentId, 'seg_sc1_01');
    assert.equal(result.segment.speaker, '霍尔莫斯');
    assert.equal(result.segment.emotion, 'resolute');
    assert.ok(result.segment.voiceId.includes('霍尔莫斯') || result.segment.voiceId.includes('voice_zh_'));
    assert.ok(result.segment.durationSec > 0);

    // 检查 ProjectStore 中的 voice_review 产物
    const artifact = store.getArtifact<any>(testProjectId, 'voice_review');
    assert.ok(artifact);
    assert.equal(artifact.totalSegments, 1);
    assert.ok(artifact.characterVoices['霍尔莫斯']);
    assert.equal(artifact.characterVoices['霍尔莫斯'], result.segment.voiceId);

    // 检查本地磁盘音频文件真实写入
    const localAudio = path.resolve(config.paths.projects, testProjectId, 'audio', 'seg_sc1_01.mp3');
    assert.ok(fs.existsSync(localAudio), '音频切片必须在本地物理沙箱落盘');
  });

  it('2. 第二句台词未传 voiceId 时，必须全局锁定并自动继承首次配置的音色', async () => {
    const customVoiceId = 'voice_actor_premium_elder_07';

    // 第一次录制：显式指定角色音色
    await (generateVoiceTool.execute as any)({
      projectId: testProjectId,
      segmentId: 'seg_sc1_01',
      speaker: '守夜人',
      text: '钟楼的钟声停了。',
      voiceId: customVoiceId,
      rate: 1.0,
      isMock: true,
    });

    // 第二次录制：不传 voiceId，调节语速与情绪
    const res2: any = await (generateVoiceTool.execute as any)({
      projectId: testProjectId,
      segmentId: 'seg_sc1_02',
      speaker: '守夜人',
      text: '它在三点整突然哑了声，我敢发誓绝对有人动了指针！',
      rate: 1.25,
      emotion: 'fear',
      isMock: true,
    });

    assert.equal(res2.success, true);
    assert.equal(res2.segment.voiceId, customVoiceId, '必须自动继承该角色已锁定的 voiceId');
    assert.equal(res2.segment.rate, 1.25);
    assert.equal(res2.segment.emotion, 'fear');

    // 检查全片工件总数与总时长
    const artifact = store.getArtifact<any>(testProjectId, 'voice_review');
    assert.equal(artifact.totalSegments, 2);
    assert.ok(artifact.totalDurationSec > 0);
  });
});
