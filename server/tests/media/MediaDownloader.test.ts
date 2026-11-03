/**
 * MediaDownloader.test.ts
 * 媒体资产离线持久化下载器 (MediaDownloader SSOT) 独立自动化单元测试套件
 *
 * 遵循法典规范：
 * 1. 刚性阻断优于隐式苟且 (法典 0.4 Fail-Fast Over Silent Degrade)：网络故障或 404/500 时坚决抛错，拒绝静默假收敛。
 * 2. 真实视听文件闭环验收 (法典 4.2 拒绝假收敛)：文件落盘必须真实存在 (fs.existsSync) 且 size > 0。
 * 3. 路径穿越刚性防御：剥离目录序列，白名单字符清洗，严防逃逸到沙箱外部。
 * 4. 物理隔离与幂等设计：严格运行于 data/test_projects 沙箱，测试前后自愈清理。
 */

import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { MediaDownloader } from '../../src/media/MediaDownloader.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { config } from '../../src/utils/config.js';
import { SessionStatus, WorkflowStage } from '../../src/types/index.js';

describe('MediaDownloader 媒体离线持久化下载器单元测试套件', () => {
  const testProjectId = 'test_media_downloader_sandbox';
  const projectDir = path.resolve(config.paths.projects, testProjectId);

  before(() => {
    // 幂等清理旧沙箱残留
    if (fs.existsSync(projectDir)) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {}
    }

    // 在 ProjectStore 中初始化测试工程
    const store = ProjectStore.getInstance();
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: 'MediaDownloader 自动化测试沙箱工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '自动化媒体单测', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  after(() => {
    // 幂等清理沙箱工程目录，杜绝文件残留
    if (fs.existsSync(projectDir)) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {}
    }
  });

  afterEach(() => {
    // 每一个测试用例完成后重置所有 mock，杜绝用例间污染
    mock.restoreAll();
  });

  // =========================================================================
  // 1. 路径直通与非 HTTP(S) 协议安全跳过
  // =========================================================================
  describe('1. 路径直通与非 HTTP(S) 协议安全跳过', () => {
    it('1.1 已有 /media/ 格式相对路径直通返回，不发起重复下载且无 fetch 调用', async () => {
      let fetchCalled = false;
      mock.method(globalThis as any, 'fetch', async () => {
        fetchCalled = true;
        return new Response('should not be called');
      });

      const downloader = MediaDownloader.getInstance();
      const existingPath = `/media/${testProjectId}/keyframes/keyframe_001.png`;
      const result = await downloader.downloadToProject(testProjectId, existingPath, 'keyframes');

      assert.equal(result, existingPath, '已存在的 /media/ 路径必须原样直通返回');
      assert.equal(fetchCalled, false, '直通路径绝对不得触发网络请求');
    });

    it('1.2 本地 file:// 协议直通返回', async () => {
      let fetchCalled = false;
      mock.method(globalThis as any, 'fetch', async () => {
        fetchCalled = true;
        return new Response('should not be called');
      });

      const downloader = MediaDownloader.getInstance();
      const localFilePath = 'file:///e:/data/projects/test/video/clip_01.mp4';
      const result = await downloader.downloadToProject(testProjectId, localFilePath, 'video');

      assert.equal(result, localFilePath, 'file:// 协议必须原样直通返回');
      assert.equal(fetchCalled, false, '本地 file:// 协议不应发起 fetch 调用');
    });

    it('1.3 非 HTTP/HTTPS 协议（data: Base64 URI）安全跳过', async () => {
      let fetchCalled = false;
      mock.method(globalThis as any, 'fetch', async () => {
        fetchCalled = true;
        return new Response('should not be called');
      });

      const downloader = MediaDownloader.getInstance();
      const dataUri =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = await downloader.downloadToProject(testProjectId, dataUri, 'portraits');

      assert.equal(result, dataUri, 'data: 协议 URI 必须原样安全跳过');
      assert.equal(fetchCalled, false);
    });

    it('1.4 非 HTTP/HTTPS 协议（blob: URI）安全跳过', async () => {
      let fetchCalled = false;
      mock.method(globalThis as any, 'fetch', async () => {
        fetchCalled = true;
        return new Response('should not be called');
      });

      const downloader = MediaDownloader.getInstance();
      const blobUri = 'blob:http://localhost:8000/a35f791e-1234-5678-abcd';
      const result = await downloader.downloadToProject(testProjectId, blobUri, 'video');

      assert.equal(result, blobUri, 'blob: 协议 URI 必须原样安全跳过');
      assert.equal(fetchCalled, false);
    });

    it('1.5 空字符串或异常非字符串入参安全防御', async () => {
      const downloader = MediaDownloader.getInstance();
      const emptyResult = await downloader.downloadToProject(testProjectId, '', 'keyframes');
      assert.equal(emptyResult, '', '空字符串入参安全返回空');

      const nullResult = await downloader.downloadToProject(testProjectId, null as any, 'keyframes');
      assert.equal(nullResult, null, 'null 入参安全返回 null');
    });
  });

  // =========================================================================
  // 2. 远程合法 URL 成功下载与沙箱物理落盘
  // =========================================================================
  describe('2. 远程合法 URL 成功下载与沙箱物理落盘', () => {
    it('2.1 合法远程带签名 URL 成功下载并标准化落盘 (fs.existsSync 且 size > 0)', async () => {
      const fakeImageData = Buffer.from('FAKE_IMAGE_BINARY_DATA_FOR_KEYFRAME_TEST_2026');
      let requestedUrl = '';

      mock.method(globalThis as any, 'fetch', async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(fakeImageData, {
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'image/jpeg',
            'content-length': String(fakeImageData.length),
          },
        });
      });

      const remoteUrl =
        'https://dashscope.oss-cn-beijing.aliyuncs.com/temp/wanx_keyframe_test.jpg?OSSAccessKeyId=test1234&Expires=1700000000';
      const downloader = MediaDownloader.getInstance();
      const result = await downloader.downloadToProject(testProjectId, remoteUrl, 'keyframes');

      // 1. 验证标准化路径格式
      assert.ok(
        result.startsWith(`/media/${testProjectId}/keyframes/`),
        `返回路径必须为标准 /media/:projectId/keyframes/ 格式，实际为: ${result}`
      );
      assert.ok(result.endsWith('.jpg'), `必须基于 URL pathname 正确提取 .jpg 后缀，实际为: ${result}`);

      // 2. 验证物理文件真实落盘在沙箱工程目录中
      const relativeFile = result.replace(`/media/${testProjectId}/keyframes/`, '');
      const diskPath = path.join(projectDir, 'keyframes', relativeFile);

      assert.ok(fs.existsSync(diskPath), `物理落盘文件必须真实存在: ${diskPath}`);
      const stat = fs.statSync(diskPath);
      assert.ok(stat.size > 0, '落盘文件大小必须大于 0');
      assert.equal(stat.size, fakeImageData.length, '落盘文件大小必须与原始二进制完全一致');

      const content = fs.readFileSync(diskPath);
      assert.deepEqual(content, fakeImageData, '落盘文件内容必须完全保真');
      assert.equal(requestedUrl, remoteUrl, 'fetch 调用的 URL 必须完整包含原始签名参数');
    });

    it('2.2 无扩展名或过长扩展名的动态 URL 根据 subfolder 智能兜底扩展名', async () => {
      const downloader = MediaDownloader.getInstance();
      const testPayload = Buffer.from('GENERIC_MEDIA_DATA_BUFFER');

      // 测试 video -> .mp4
      mock.method(globalThis as any, 'fetch', async () => {
        return new Response(testPayload, { status: 200 });
      });
      const videoResult = await downloader.downloadToProject(
        testProjectId,
        'https://api.example.com/v1/media/stream_dynamic_video?id=999888',
        'video'
      );
      assert.ok(videoResult.endsWith('.mp4'), `video 子目录应兜底 .mp4，实际为: ${videoResult}`);
      mock.restoreAll();

      // 测试 audio -> .mp3
      mock.method(globalThis as any, 'fetch', async () => {
        return new Response(testPayload, { status: 200 });
      });
      const audioResult = await downloader.downloadToProject(
        testProjectId,
        'https://api.example.com/v1/voice/synthesize_stream?token=abc',
        'audio'
      );
      assert.ok(audioResult.endsWith('.mp3'), `audio 子目录应兜底 .mp3，实际为: ${audioResult}`);
      mock.restoreAll();

      // 测试 keyframes/portraits -> .png
      mock.method(globalThis as any, 'fetch', async () => {
        return new Response(testPayload, { status: 200 });
      });
      const portraitResult = await downloader.downloadToProject(
        testProjectId,
        'https://api.example.com/v1/images/generate_raw_data',
        'portraits'
      );
      assert.ok(portraitResult.endsWith('.png'), `默认子目录应兜底 .png，实际为: ${portraitResult}`);
    });

    it('2.3 自定义文件名 (customFilename) 正确生效并标准化落盘', async () => {
      const fakeImageData = Buffer.from('CUSTOM_PORTRAIT_DATA_BINARY');
      mock.method(globalThis as any, 'fetch', async () => {
        return new Response(fakeImageData, { status: 200 });
      });

      const downloader = MediaDownloader.getInstance();
      const result = await downloader.downloadToProject(
        testProjectId,
        'https://example.com/character_raw.png',
        'portraits',
        'hero_character_v1'
      );

      assert.equal(
        result,
        `/media/${testProjectId}/portraits/hero_character_v1.png`,
        '自定义文件名必须正确与探测到的扩展名结合'
      );

      const diskPath = path.join(projectDir, 'portraits', 'hero_character_v1.png');
      assert.ok(fs.existsSync(diskPath), '自定义文件必须真实落盘');
      assert.equal(fs.statSync(diskPath).size, fakeImageData.length);
    });
  });

  // =========================================================================
  // 3. 路径穿越攻击安全防御 (Path Traversal Security Defense)
  // =========================================================================
  describe('3. 路径穿越攻击安全防御', () => {
    it('3.1 路径穿越攻击防御：customFilename 包含 ../ 逃逸被 path.basename 剥离', async () => {
      const fakeData = Buffer.from('SECURITY_PAYLOAD_SAFE');
      mock.method(globalThis as any, 'fetch', async () => {
        return new Response(fakeData, { status: 200 });
      });

      const downloader = MediaDownloader.getInstance();
      // 模拟恶意输入：试图逃逸至项目目录之外
      const maliciousName = '../../../../etc/passwd';
      const result = await downloader.downloadToProject(
        testProjectId,
        'https://example.com/exploit.png',
        'portraits',
        maliciousName
      );

      // 1. 验证返回路径严禁出现任何 '..'
      assert.ok(!result.includes('..'), `返回的标准化路径严禁包含 .. 逃逸符: ${result}`);
      assert.ok(result.startsWith(`/media/${testProjectId}/portraits/`));

      // 2. 验证落盘文件被安全限制在当前项目的 portraits 目录内
      const filename = path.basename(result);
      assert.ok(filename.includes('passwd'), '应仅保留文件名本身并附加安全后缀');
      const safeDiskPath = path.join(projectDir, 'portraits', filename);
      assert.ok(fs.existsSync(safeDiskPath), `文件必须被约束在沙箱内: ${safeDiskPath}`);

      // 3. 验证沙箱父目录及项目根绝对没有泄漏生成 passwd 文件
      const leakedPath1 = path.join(config.paths.projects, 'passwd.png');
      const leakedPath2 = path.resolve(process.cwd(), 'passwd.png');
      assert.equal(fs.existsSync(leakedPath1), false, '严禁向沙箱根目录写盘');
      assert.equal(fs.existsSync(leakedPath2), false, '严禁向工作区根目录写盘');
    });

    it('3.2 路径穿越防御：Windows 反斜杠 ..\\ 目录穿越被安全剥离', async () => {
      const fakeData = Buffer.from('WINDOWS_PAYLOAD_SAFE');
      mock.method(globalThis as any, 'fetch', async () => {
        return new Response(fakeData, { status: 200 });
      });

      const downloader = MediaDownloader.getInstance();
      const maliciousWindowsName = '..\\..\\..\\windows\\system32\\calc.exe';
      const result = await downloader.downloadToProject(
        testProjectId,
        'https://example.com/calc.png',
        'video',
        maliciousWindowsName
      );

      assert.ok(!result.includes('..'), '不得包含 .. 序列');
      assert.ok(!result.includes('\\'), '标准化路径不得包含反斜杠');
      assert.ok(result.startsWith(`/media/${testProjectId}/video/`));

      const filename = path.basename(result);
      const diskPath = path.join(projectDir, 'video', filename);
      assert.ok(fs.existsSync(diskPath), '必须安全落盘在 video 目录');
    });

    it('3.3 customFilename 特殊字符 (冒号、星号、问号) 被白名单替换为下划线', async () => {
      const fakeData = Buffer.from('SPECIAL_CHAR_SAFE');
      mock.method(globalThis as any, 'fetch', async () => {
        return new Response(fakeData, { status: 200 });
      });

      const downloader = MediaDownloader.getInstance();
      const weirdFilename = 'shot:1*hero?v2<tag>.png';
      const result = await downloader.downloadToProject(
        testProjectId,
        'https://example.com/sample.png',
        'keyframes',
        weirdFilename
      );

      assert.ok(!result.includes(':') && !result.includes('*') && !result.includes('?'), '特殊符号必须被净化');
      assert.equal(result, `/media/${testProjectId}/keyframes/shot_1_hero_v2_tag_.png`);
      const diskPath = path.join(projectDir, 'keyframes', 'shot_1_hero_v2_tag_.png');
      assert.ok(fs.existsSync(diskPath));
    });
  });

  // =========================================================================
  // 4. 刚性 Fail-Fast 异常阻断（法典 0.4 坚决消灭假收敛）
  // =========================================================================
  describe('4. 刚性 Fail-Fast 异常阻断', () => {
    it('4.1 刚性 Fail-Fast：远端 HTTP 404 时必须抛出异常 (assert.rejects)，绝不静默返回原始 URL', async () => {
      let fetchAttempts = 0;
      mock.method(globalThis as any, 'fetch', async () => {
        fetchAttempts++;
        return new Response('File Not Found', {
          status: 404,
          statusText: 'Not Found',
        });
      });

      const downloader = MediaDownloader.getInstance();
      const remote404Url = 'https://dashscope.oss-cn-beijing.aliyuncs.com/temp/expired_404.jpg';

      // 刚性阻断验证：必须抛出 Error，绝不能返回 remote404Url 冒充成功 (假收敛)
      await assert.rejects(
        async () => {
          await downloader.downloadToProject(testProjectId, remote404Url, 'keyframes');
        },
        (err: any) => {
          assert.ok(err instanceof Error, '抛出的必须是 Error 实例');
          assert.ok(
            err.message.includes('404') || err.message.includes('MediaDownloader'),
            `错误信息应包含 HTTP 404 或下载失败指示，实际为: ${err.message}`
          );
          return true;
        },
        '下载失败时坚决抛错阻断，严禁返回原始 URL 导致 24 小时后下游断裂'
      );

      assert.equal(fetchAttempts, 2, '必须执行 2 次重试尝试');
    });

    it('4.2 刚性 Fail-Fast：远端 HTTP 500 时必须抛出异常阻断流水线', async () => {
      mock.method(globalThis as any, 'fetch', async () => {
        return new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
        });
      });

      const downloader = MediaDownloader.getInstance();
      const remote500Url = 'https://api.example.com/v1/error_500.png';

      await assert.rejects(
        async () => {
          await downloader.downloadToProject(testProjectId, remote500Url, 'portraits');
        },
        (err: any) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('500') || err.message.includes('MediaDownloader'));
          return true;
        }
      );
    });

    it('4.3 刚性 Fail-Fast：网络层不可达抛错 (ENOTFOUND) 重试耗尽后刚性抛错', async () => {
      let calls = 0;
      mock.method(globalThis as any, 'fetch', async () => {
        calls++;
        throw new TypeError('fetch failed: getaddrinfo ENOTFOUND invalid.domain.test');
      });

      const downloader = MediaDownloader.getInstance();
      const unresolvableUrl = 'https://invalid.domain.test/temp/unreachable.png';

      await assert.rejects(
        async () => {
          await downloader.downloadToProject(testProjectId, unresolvableUrl, 'keyframes');
        },
        (err: any) => {
          assert.ok(err instanceof Error);
          return true;
        }
      );

      assert.equal(calls, 2, '网络异常时必须重试满 2 次');
    });
  });

  // =========================================================================
  // 5. 零字节与损坏文件防御 (Zero-Byte & Corrupted File Guard)
  // =========================================================================
  describe('5. 零字节与损坏文件防御', () => {
    it('5.1 响应体为空 (response.body 为 null) 时刚性抛出异常', async () => {
      mock.method(globalThis as any, 'fetch', async () => {
        return new Response(null, {
          status: 200,
          statusText: 'OK',
        });
      });

      const downloader = MediaDownloader.getInstance();
      const nullBodyUrl = 'https://example.com/null_body_media.png';

      await assert.rejects(
        async () => {
          await downloader.downloadToProject(testProjectId, nullBodyUrl, 'keyframes');
        },
        (err: any) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('响应体为空') || err.message.includes('MediaDownloader'));
          return true;
        }
      );
    });

    it('5.2 响应流为空导致写入 0 字节文件时刚性抛错，拒绝假收敛', async () => {
      mock.method(globalThis as any, 'fetch', async () => {
        return new Response(Buffer.alloc(0), {
          status: 200,
          statusText: 'OK',
        });
      });

      const downloader = MediaDownloader.getInstance();
      const zeroByteUrl = 'https://example.com/zero_byte_media.png';

      await assert.rejects(
        async () => {
          await downloader.downloadToProject(testProjectId, zeroByteUrl, 'keyframes');
        },
        (err: any) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('下载文件为空') || err.message.includes('MediaDownloader'));
          return true;
        }
      );
    });
  });

  // =========================================================================
  // 6. 沙箱隔离验证
  // =========================================================================
  describe('6. 沙箱隔离验证', () => {
    it('6.1 沙箱隔离验证：确保所有媒体下载仅发生于 data/test_projects 物理隔离区', () => {
      const productionProjectsDir = path.resolve(process.cwd(), 'data', 'projects');
      const leakedProdPath = path.join(productionProjectsDir, testProjectId);
      assert.equal(fs.existsSync(leakedProdPath), false, '生产目录绝对不得产生测试脏数据');
    });
  });
});
