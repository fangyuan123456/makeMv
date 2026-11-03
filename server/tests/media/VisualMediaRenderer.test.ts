/**
 * VisualMediaRenderer.test.ts
 * 视听资产物理落盘渲染中枢 (VisualMediaRenderer SSOT) 独立自动化单元测试套件
 */

import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { VisualMediaRenderer } from '../../src/media/VisualMediaRenderer.js';
import { FFmpegService } from '../../src/media/ffmpeg.js';
import { MediaProviderFactory } from '../../src/media/providers/MediaProviderFactory.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { config } from '../../src/utils/config.js';
import { SessionStatus, WorkflowStage } from '../../src/types/index.js';

describe('VisualMediaRenderer 视听渲染中枢单元测试套件', () => {
  const testProjectId = 'test_visual_renderer_sandbox';
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
      title: 'VisualMediaRenderer 自动化测试工程',
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

  describe('1. FFmpeg 实例依赖注入', () => {
    it('1.1 setFFmpegService / getFFmpegService 支持测试注入', () => {
      const customFFmpeg = new FFmpegService('custom/bin/ffmpeg');
      VisualMediaRenderer.setFFmpegService(customFFmpeg);
      assert.equal(VisualMediaRenderer.getFFmpegService().getFfmpegPath(), 'custom/bin/ffmpeg');
      // 还原
      VisualMediaRenderer.setFFmpegService(new FFmpegService());
    });
  });

  describe('2. 角色定妆照渲染 (renderCharacterPortrait)', () => {
    it('2.1 Mock 模式：正常渲染定妆照，生成实体 JPEG 文件且标记 isDegraded', async () => {
      const result = await VisualMediaRenderer.renderCharacterPortrait(
        testProjectId,
        '林晓',
        undefined,
        { isMock: true }
      );

      assert.ok(result.url.startsWith(`/media/${testProjectId}/characters/`));
      assert.ok(result.url.endsWith('.jpg'));
      assert.equal(result.isDegraded, true);
      assert.ok(result.degradedReason?.includes('Mock'));

      const relPath = result.url.replace(`/media/${testProjectId}/`, '');
      const diskPath = path.join(projectDir, relPath);
      assert.ok(fs.existsSync(diskPath), `物理文件必须真实存在: ${diskPath}`);
      assert.ok(fs.statSync(diskPath).size > 0, '落盘文件体积必须大于 0');
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

      const result = await VisualMediaRenderer.renderCharacterPortrait(
        testProjectId,
        '苏瑶',
        '高画质电影剧照，女主角苏瑶'
      );

      assert.equal(result.isDegraded, false);
      assert.ok(result.url.startsWith(`/media/${testProjectId}/characters/`));

      const relPath = result.url.replace(`/media/${testProjectId}/`, '');
      const diskPath = path.join(projectDir, relPath);
      assert.ok(fs.existsSync(diskPath));
      assert.equal(fs.statSync(diskPath).size, fakeImageData.length);
    });
  });

  describe('3. 分镜头关键帧基准图渲染 (renderKeyframeImage)', () => {
    it('3.1 Mock 模式：横屏 16:9 与竖屏 9:16 均能正常生成合法文件', async () => {
      // 16:9 横屏
      const result169 = await VisualMediaRenderer.renderKeyframeImage(
        testProjectId,
        'shot_001',
        '16:9',
        undefined,
        { isMock: true }
      );
      assert.ok(result169.url.startsWith(`/media/${testProjectId}/keyframes/`));
      assert.equal(result169.isDegraded, true);

      const disk169 = path.join(projectDir, result169.url.replace(`/media/${testProjectId}/`, ''));
      assert.ok(fs.existsSync(disk169));
      assert.ok(fs.statSync(disk169).size > 0);

      // 9:16 竖屏
      const result916 = await VisualMediaRenderer.renderKeyframeImage(
        testProjectId,
        'shot_002',
        '9:16',
        undefined,
        { isMock: true }
      );
      assert.ok(result916.url.startsWith(`/media/${testProjectId}/keyframes/`));
      assert.equal(result916.isDegraded, true);

      const disk916 = path.join(projectDir, result916.url.replace(`/media/${testProjectId}/`, ''));
      assert.ok(fs.existsSync(disk916));
      assert.ok(fs.statSync(disk916).size > 0);
    });
  });

  describe('4. 动态视频切片渲染 (renderVideoClip)', () => {
    it('4.1 Mock 模式：动态视频切片正常生成，实体 MP4 文件落盘', async () => {
      const result = await VisualMediaRenderer.renderVideoClip(
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

      const diskPath = path.join(projectDir, result.url.replace(`/media/${testProjectId}/`, ''));
      assert.ok(fs.existsSync(diskPath), `物理 MP4 文件必须真实存在: ${diskPath}`);
      assert.ok(fs.statSync(diskPath).size > 0, 'MP4 文件大小必须大于 0');
    });
  });
});
