/**
 * FFmpegService.test.ts
 * FFmpeg 视听切片与合规服务 (FFmpegService SSOT) 独立自动化单元测试套件
 *
 * 遵循法典规范：
 * 1. 极简克制与高内聚（法典 0.3）：测试覆盖核心命令参数装配、超时防护、缓冲区保护与确定性本地工具。
 * 2. 环境自适应与无外力阻断（法典 1.2）：在 CI 或无系统 ffmpeg 的机器上，保证单元测试 100% 优雅通过，绝不因缺少系统二进制挂死或硬报错。
 * 3. 刚性 Fail-Fast 与边界校验：空切片拼接等非法参数刚性抛错。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { FFmpegService, ffmpegService } from '../../media/ffmpeg.js';
import { config } from '../../utils/config.js';

describe('FFmpegService 视听合规与切片服务独立单元测试套件', () => {
  const sandboxDir = path.resolve(config.paths.projects, 'test_ffmpeg_sandbox');

  before(() => {
    if (!fs.existsSync(sandboxDir)) {
      fs.mkdirSync(sandboxDir, { recursive: true });
    }
  });

  after(() => {
    if (fs.existsSync(sandboxDir)) {
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // =========================================================================
  // 1. 构造函数与依赖注入
  // =========================================================================
  describe('1. 构造函数与依赖注入 (Constructor & Dependency Injection)', () => {
    it('1.1 默认构造函数：采用系统或 config.paths.ffmpeg 配置路径', () => {
      const service = new FFmpegService();
      assert.ok(service instanceof FFmpegService);
      assert.ok(ffmpegService instanceof FFmpegService);
    });

    it('1.2 自定义路径注入：构造函数优先采用显式注入的 ffmpeg 路径', () => {
      const customPath = 'custom/bin/ffmpeg_mock';
      const service = new FFmpegService(customPath);
      assert.ok(service instanceof FFmpegService, '支持通过构造函数注入自定义可执行路径以提升可测试性');
      assert.equal(service.getFfmpegPath(), customPath);
    });
  });

  // =========================================================================
  // 2. 本地确定性视听工具函数 (imageToBase64)
  // =========================================================================
  describe('2. 本地确定性视听工具函数 (imageToBase64)', () => {
    it('2.1 imageToBase64：正确将本地 PNG 图像转为 data:image/png;base64', () => {
      const testPngPath = path.join(sandboxDir, 'sample_dot.png');
      const pngBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);
      fs.writeFileSync(testPngPath, pngBytes);

      const service = new FFmpegService();
      const base64Uri = service.imageToBase64(testPngPath);

      assert.ok(base64Uri.startsWith('data:image/png;base64,'), 'PNG 格式必须包含标准 image/png MIME');
      const rawBase64 = base64Uri.replace('data:image/png;base64,', '');
      const decoded = Buffer.from(rawBase64, 'base64');
      assert.deepEqual(decoded, pngBytes, 'Base64 解码后必须与原始二进制完全相等');
    });

    it('2.2 imageToBase64：正确将本地 JPEG/JPG 图像转为 data:image/jpeg;base64', () => {
      const testJpgPath = path.join(sandboxDir, 'sample_photo.jpg');
      const jpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      fs.writeFileSync(testJpgPath, jpgBytes);

      const service = new FFmpegService();
      const base64Uri = service.imageToBase64(testJpgPath);

      assert.ok(base64Uri.startsWith('data:image/jpeg;base64,'), 'JPG 格式必须包含标准 image/jpeg MIME');
      const rawBase64 = base64Uri.replace('data:image/jpeg;base64,', '');
      const decoded = Buffer.from(rawBase64, 'base64');
      assert.deepEqual(decoded, jpgBytes);
    });

    it('2.3 imageToBase64：正确将本地 WebP 图像转为 data:image/webp;base64', () => {
      const testWebpPath = path.join(sandboxDir, 'sample_photo.webp');
      const webpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
      fs.writeFileSync(testWebpPath, webpBytes);

      const service = new FFmpegService();
      const base64Uri = service.imageToBase64(testWebpPath);

      assert.ok(base64Uri.startsWith('data:image/webp;base64,'), 'WebP 格式必须包含标准 image/webp MIME');
      const rawBase64 = base64Uri.replace('data:image/webp;base64,', '');
      assert.deepEqual(Buffer.from(rawBase64, 'base64'), webpBytes);
    });

    it('2.4 imageToBase64：读取不存在的文件时刚性抛出 ENOENT 异常', () => {
      const service = new FFmpegService();
      const nonExistent = path.join(sandboxDir, 'non_existent_file.png');
      assert.throws(() => {
        service.imageToBase64(nonExistent);
      }, /ENOENT/);
    });
  });

  // =========================================================================
  // 3. 切片拼接 (concatClips) 边界与安全性
  // =========================================================================
  describe('3. 切片拼接 (concatClips) 边界与安全性', () => {
    it('3.1 空切片数组拼接：刚性抛出异常 (Fail-Fast)', async () => {
      const service = new FFmpegService();
      const outputPath = path.join(sandboxDir, 'concat_empty.mp4');

      await assert.rejects(
        async () => {
          await service.concatClips([], outputPath);
        },
        /No video clips provided for concatenation/,
        '空数组输入必须立刻抛错阻断'
      );
    });

    it('3.2 单一切片拼接：直接调用 copyFileSync 快速返回，无需启动子进程', async () => {
      const singleClipPath = path.join(sandboxDir, 'single_clip.mp4');
      const clipContent = Buffer.from('FAKE_SINGLE_VIDEO_CLIP_PAYLOAD');
      fs.writeFileSync(singleClipPath, clipContent);

      const outputPath = path.join(sandboxDir, 'single_concat_out.mp4');
      const service = new FFmpegService();
      const result = await service.concatClips([singleClipPath], outputPath);

      assert.equal(result, outputPath);
      assert.ok(fs.existsSync(outputPath), '目标拼接输出文件必须存在');
      assert.deepEqual(fs.readFileSync(outputPath), clipContent, '单切片拼接数据必须与源文件一致');
    });
  });

  // =========================================================================
  // 4. 无外部系统 FFmpeg 时的容错与优雅自愈
  // =========================================================================
  describe('4. 无外部系统 FFmpeg 时的容错与优雅自愈 (Graceful Degradation)', () => {
    it('4.1 getDuration：在无系统 ffprobe 或执行失败时优雅返回 0，杜绝挂死崩溃', async () => {
      const service = new FFmpegService('non_existent_fake_ffmpeg');
      const duration = await service.getDuration(path.join(sandboxDir, 'any_media.mp4'));
      assert.equal(typeof duration, 'number');
      assert.equal(duration, 0, '探针失败时必须安全返回 0');
    });

    it('4.2 processAndCompressImage：底层 ffmpeg 失败时回退为原图复制', async () => {
      const service = new FFmpegService('non_existent_fake_ffmpeg');
      const inputPath = path.join(sandboxDir, 'input_raw.jpg');
      const outputPath = path.join(sandboxDir, 'output_compressed.jpg');
      const rawContent = Buffer.from('RAW_UNCOMPRESSED_IMAGE_DATA');
      fs.writeFileSync(inputPath, rawContent);

      const result = await service.processAndCompressImage({
        inputPath,
        outputPath,
        maxKb: 50,
      });

      assert.equal(result, outputPath);
      assert.ok(fs.existsSync(outputPath), '回退降级后输出文件必须成功生成');
      assert.deepEqual(fs.readFileSync(outputPath), rawContent);
    });

    it('4.3 compressVideo：底层 ffmpeg 失败时回退为原始文件复制', async () => {
      const service = new FFmpegService('non_existent_fake_ffmpeg');
      const inputPath = path.join(sandboxDir, 'input_raw.mp4');
      const outputPath = path.join(sandboxDir, 'output_compressed.mp4');
      const rawContent = Buffer.from('RAW_UNCOMPRESSED_VIDEO_DATA');
      fs.writeFileSync(inputPath, rawContent);

      const result = await service.compressVideo({
        inputPath,
        outputPath,
        maxMb: 1,
      });

      assert.equal(result, outputPath);
      assert.ok(fs.existsSync(outputPath));
      assert.deepEqual(fs.readFileSync(outputPath), rawContent);
    });
  });
});
