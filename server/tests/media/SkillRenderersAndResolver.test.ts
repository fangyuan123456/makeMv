/**
 * tests/media/SkillRenderersAndResolver.test.ts
 * 视听多媒体基础设施与各技能专属 Renderer 自动化测试套件
 */

import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { MediaResolver } from '../../src/media/MediaResolver.js';
import { FFmpegService } from '../../src/media/ffmpeg.js';
import { MediaProviderFactory } from '../../src/media/providers/MediaProviderFactory.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import {
  CharacterRenderer,
  KeyframeRenderer,
  VideoRenderer,
  VoiceRenderer,
} from '../../src/media/index.js';
import { config } from '../../src/utils/config.js';
import { SessionStatus, WorkflowStage } from '../../src/types/index.js';

describe('MediaResolver 与各技能专属 Renderer 测试套件', () => {
  const testProjectId = 'test_skill_renderer_sandbox';
  const projectDir = path.resolve(config.paths.projects, testProjectId);

  before(() => {
    if (fs.existsSync(projectDir)) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {}
    }

    const store = ProjectStore.getInstance();
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: 'SkillRenderers 自动化测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '自动化视听单测', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  after(() => {
    MediaProviderFactory.reset();
    if (fs.existsSync(projectDir)) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {}
    }
  });

  afterEach(() => {
    MediaProviderFactory.reset();
    mock.restoreAll();
  });

  describe('1. MediaResolver 路径映射与安全沙箱', () => {
    it('1.1 toMediaUrl 与 resolveDiskPath 契约对齐且能防路径逃逸', () => {
      const url = MediaResolver.toMediaUrl(testProjectId, 'keyframes', 'frame_1.jpg');
      assert.strictEqual(url, `/media/${testProjectId}/keyframes/frame_1.jpg`);

      // 越权路径穿越尝试防御
      const maliciousUrl = `/media/${testProjectId}/../../../etc/passwd`;
      const resolved = MediaResolver.resolveDiskPath(maliciousUrl);
      assert.strictEqual(resolved.isValid, false);
    });

    it('1.2 getMimeType 准确识别各类媒体格式', () => {
      assert.strictEqual(MediaResolver.getMimeType('test.mp4'), 'video/mp4');
      assert.strictEqual(MediaResolver.getMimeType('test.png'), 'image/png');
      assert.strictEqual(MediaResolver.getMimeType('test.jpg'), 'image/jpeg');
      assert.strictEqual(MediaResolver.getMimeType('test.webp'), 'image/webp');
      assert.strictEqual(MediaResolver.getMimeType('test.mp3'), 'audio/mpeg');
      assert.strictEqual(MediaResolver.getMimeType('test.wav'), 'audio/wav');
      assert.strictEqual(MediaResolver.getMimeType('test.json'), 'application/json');
    });
  });

  describe('2. CharacterRenderer 角色定妆照与三视图渲染', () => {
    it('2.1 Mock 模式：正常渲染定妆照，生成实体 JPEG 文件且标记 isDegraded', async () => {
      const result = await CharacterRenderer.renderCharacterPortrait(
        testProjectId,
        '林晓',
        undefined,
        { isMock: true }
      );

      assert.ok(result.url.startsWith(`/media/${testProjectId}/characters/`));
      assert.ok(result.url.endsWith('.jpg'));
      assert.equal(result.isDegraded, true);

      const resolved = MediaResolver.resolveDiskPath(result.url, testProjectId);
      assert.ok(resolved.isValid, `物理文件必须真实存在: ${resolved.diskPath}`);
      assert.ok(fs.statSync(resolved.diskPath).size > 0, '落盘文件体积必须大于 0');
    });

    it('2.2 真实文生图驱动：成功流式持久化落地且标记 isDegraded = false', async () => {
      const fakeImageData = Buffer.from('FAKE_WANX_PORTRAIT_BINARY_DATA');
      const remoteUrl = 'https://fake-dashscope.aliyuncs.com/temp/wanx_portrait_gen.jpg';

      mock.method(globalThis as any, 'fetch', async () => {
        return new Response(fakeImageData, { status: 200 });
      });

      MediaProviderFactory.setImageProvider({
        name: 'mock-provider',
        generateImage: async () => remoteUrl,
      });

      const result = await CharacterRenderer.renderCharacterPortrait(
        testProjectId,
        '苏瑶',
        '高画质电影剧照，女主角苏瑶'
      );

      assert.equal(result.isDegraded, false);
      assert.ok(result.url.startsWith(`/media/${testProjectId}/characters/`));

      const resolved = MediaResolver.resolveDiskPath(result.url, testProjectId);
      assert.ok(resolved.isValid);
      assert.equal(fs.statSync(resolved.diskPath).size, fakeImageData.length);
    });
  });

  describe('3. KeyframeRenderer 分镜关键帧渲染', () => {
    it('3.1 Mock 模式：横屏 16:9 与竖屏 9:16 均能正常生成合法文件', async () => {
      const result169 = await KeyframeRenderer.renderKeyframeImage(
        testProjectId,
        'shot_001',
        '16:9',
        undefined,
        { isMock: true }
      );
      assert.ok(result169.url.startsWith(`/media/${testProjectId}/keyframes/`));
      assert.equal(result169.isDegraded, true);

      const resolved169 = MediaResolver.resolveDiskPath(result169.url, testProjectId);
      assert.ok(resolved169.isValid);
      assert.ok(fs.statSync(resolved169.diskPath).size > 0);

      const result916 = await KeyframeRenderer.renderKeyframeImage(
        testProjectId,
        'shot_002',
        '9:16',
        undefined,
        { isMock: true }
      );
      assert.ok(result916.url.startsWith(`/media/${testProjectId}/keyframes/`));
      assert.equal(result916.isDegraded, true);

      const resolved916 = MediaResolver.resolveDiskPath(result916.url, testProjectId);
      assert.ok(resolved916.isValid);
      assert.ok(fs.statSync(resolved916.diskPath).size > 0);
    });
  });

  describe('4. VideoRenderer 动态视频切片渲染', () => {
    it('4.1 Mock 模式：动态视频切片正常生成，实体 MP4 文件落盘', async () => {
      const result = await VideoRenderer.renderVideoClip(
        testProjectId,
        'clip_001',
        'shot_001',
        3,
        '720P',
        '16:9',
        undefined,
        undefined,
        { isMock: true }
      );

      assert.ok(result.url.startsWith(`/media/${testProjectId}/video/`));
      assert.ok(result.url.endsWith('.mp4'));
      assert.equal(result.isDegraded, true);

      const resolved = MediaResolver.resolveDiskPath(result.url, testProjectId);
      assert.ok(resolved.isValid, `物理 MP4 文件必须真实存在: ${resolved.diskPath}`);
      assert.ok(fs.statSync(resolved.diskPath).size > 0, 'MP4 文件大小必须大于 0');
    });
  });

  describe('5. VoiceRenderer 台词配音渲染', () => {
    it('5.1 正常生成台词音频文件，实体 MP3 文件落盘', async () => {
      const result = await VoiceRenderer.renderAudioClip(
        testProjectId,
        'seg_sc1_01',
        '你好，这是测试台词音频',
        { isMock: true }
      );

      assert.ok(result.audioUrl.startsWith(`/media/${testProjectId}/audio/`));
      assert.ok(result.audioUrl.endsWith('.mp3'));
      assert.ok(result.durationSec > 0);

      const resolved = MediaResolver.resolveDiskPath(result.audioUrl, testProjectId);
      assert.ok(resolved.isValid, `物理 MP3 文件必须真实存在: ${resolved.diskPath}`);
      assert.ok(fs.statSync(resolved.diskPath).size > 0, 'MP3 文件大小必须大于 0');
    });
  });
});
