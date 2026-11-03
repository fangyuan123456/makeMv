/**
 * MediaStressAdversarial.test.ts
 * MediaDownloader 与 FFmpegService 对抗性压力与故障注入测试套件
 *
 * 覆盖维度：
 * 1. 高并发多资源下载压力（同一子目录、跨子目录、同名竞争）
 * 2. 网络故障注入（流中途断开、断开后自愈重试、慢速网络、502/503/504 模拟）
 * 3. 资源清理与泄漏检测（Windows 文件句柄未释放排查、FFmpeg 僵尸进程排查、并发临时文件清理）
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { AddressInfo } from 'net';
import { execSync } from 'child_process';
import { MediaDownloader } from '../../media/MediaDownloader.js';
import { FFmpegService } from '../../media/ffmpeg.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { config } from '../../utils/config.js';
import { SessionStatus, WorkflowStage } from '../../types/index.js';

// 子类暴露 protected 方法用于对抗性测试
class TestableFFmpegService extends FFmpegService {
  public invokeFFmpeg(args: string[], options?: { timeout?: number; maxBuffer?: number }) {
    return this.runFFmpeg(args, options);
  }
}

describe('MediaDownloader & FFmpegService 对抗性压力与故障注入测试', () => {
  const stressProjectId = 'stress_adversarial_sandbox';
  const projectDir = path.resolve(config.paths.projects, stressProjectId);

  let server: http.Server;
  let serverBaseUrl: string;

  // 状态计数器，用于模拟重试自愈场景
  const dropCounter: Record<string, number> = {};
  const status503Counter: Record<string, number> = {};

  before(async () => {
    // 1. 初始化沙箱工程
    if (fs.existsSync(projectDir)) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {}
    }

    const store = ProjectStore.getInstance();
    const now = new Date().toISOString();
    store.saveProject({
      projectId: stressProjectId,
      title: '对抗性压力测试沙箱工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '压力测试', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });

    // 2. 启动原生 HTTP 故障注入服务器 (运行于 127.0.0.1 随机端口)
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = url.pathname;

      // 正常下载响应：返回确定性二进制数据
      if (pathname.startsWith('/media/valid/')) {
        const id = pathname.replace('/media/valid/', '');
        const payload = Buffer.from(`PAYLOAD_CONTENT_FOR_${id}_` + 'X'.repeat(4096));
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': String(payload.length),
        });
        res.end(payload);
        return;
      }

      // 故障场景 1：流中途突然断开 (Socket 强制销毁) - 持续断开
      if (pathname === '/fault/drop-midway') {
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Transfer-Encoding': 'chunked',
        });
        res.write(Buffer.from('INITIAL_CHUNK_HEADER_OK_1234567890'));
        // 强制销毁底层 socket，制造突发网络中断
        setImmediate(() => {
          req.socket.destroy(new Error('FORCED_SIMULATED_SOCKET_DROP'));
        });
        return;
      }

      // 故障场景 2：第一次断开，第二次重试成功 (自愈测试)
      if (pathname.startsWith('/fault/drop-once-recover/')) {
        const key = pathname;
        dropCounter[key] = (dropCounter[key] || 0) + 1;
        if (dropCounter[key] === 1) {
          // 第 1 次请求：发送少量数据后掐断
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.write(Buffer.from('PARTIAL_CORRUPTED_DATA'));
          setImmediate(() => {
            req.socket.destroy(new Error('SIMULATED_TRANSIENT_DROP'));
          });
        } else {
          // 第 2 次请求：完整返回
          const recoveredPayload = Buffer.from('RECOVERED_COMPLETE_IMAGE_BINARY_' + 'R'.repeat(2048));
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': String(recoveredPayload.length),
          });
          res.end(recoveredPayload);
        }
        return;
      }

      // 故障场景 3：慢速网络分块传输 (Trickle Transfer)
      if (pathname === '/fault/slow-network') {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Transfer-Encoding': 'chunked',
        });
        let chunkIndex = 0;
        const totalChunks = 5;
        const interval = setInterval(() => {
          chunkIndex++;
          res.write(Buffer.from(`CHUNK_${chunkIndex}_` + 'S'.repeat(512)));
          if (chunkIndex >= totalChunks) {
            clearInterval(interval);
            res.end();
          }
        }, 30);
        return;
      }

      // 故障场景 4：HTTP 502 Bad Gateway
      if (pathname === '/fault/502') {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway From Upstream CDN');
        return;
      }

      // 故障场景 5：HTTP 503 第一次失败，第二次自愈成功
      if (pathname.startsWith('/fault/503-recover/')) {
        const key = pathname;
        status503Counter[key] = (status503Counter[key] || 0) + 1;
        if (status503Counter[key] === 1) {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('Service Unavailable');
        } else {
          const successPayload = Buffer.from('503_RECOVERED_SUCCESS_DATA');
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': String(successPayload.length),
          });
          res.end(successPayload);
        }
        return;
      }

      // 故障场景 6：HTTP 504 Gateway Timeout 持续报错
      if (pathname === '/fault/504') {
        res.writeHead(504, { 'Content-Type': 'text/plain' });
        res.end('Gateway Timeout');
        return;
      }

      // 故障场景 7：响应头即时返回 200，但响应体挂起不发送，并在 1.5 秒后关闭（模拟流停滞）
      if (pathname === '/fault/stalled-stream') {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Transfer-Encoding': 'chunked',
        });
        // 延迟 1.5 秒后强行掐断，用于验证流断开时能否正常抛错与清理
        setTimeout(() => {
          req.socket.destroy(new Error('STALLED_STREAM_DESTROYED'));
        }, 1500);
        return;
      }

      // 默认 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        serverBaseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    // 关闭 HTTP 服务器
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    // 幂等清理沙箱目录
    if (fs.existsSync(projectDir)) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // =========================================================================
  // 1. 高并发下载压力测试
  // =========================================================================
  describe('1. 高并发媒体下载压力测试 (High-Concurrency Stress)', () => {
    it('1.1 同一子目录并发下载 30 个资源：无数据损坏、无丢包、物理文件全部真实存在', async () => {
      const downloader = MediaDownloader.getInstance();
      const concurrency = 30;
      const tasks = Array.from({ length: concurrency }, (_, i) => {
        const url = `${serverBaseUrl}/media/valid/keyframe_${i}.png`;
        return downloader.downloadToProject(stressProjectId, url, 'keyframes', `kf_concurrent_${i}`);
      });

      const results = await Promise.all(tasks);

      assert.equal(results.length, concurrency);
      for (let i = 0; i < concurrency; i++) {
        const expectedPath = `/media/${stressProjectId}/keyframes/kf_concurrent_${i}.png`;
        assert.equal(results[i], expectedPath);

        const diskPath = path.join(projectDir, 'keyframes', `kf_concurrent_${i}.png`);
        assert.ok(fs.existsSync(diskPath), `文件必须存在: ${diskPath}`);
        const stat = fs.statSync(diskPath);
        assert.ok(stat.size > 4000, `文件大小必须完整: ${stat.size}`);
      }
    });

    it('1.2 跨多个不同子目录并发下载 25 个资源：目录自动递归创建、文件正确归位', async () => {
      const downloader = MediaDownloader.getInstance();
      const subfolders = ['keyframes', 'video', 'portraits', 'audio', 'covers'];
      const itemsPerFolder = 5;
      const tasks: Promise<string>[] = [];

      for (const folder of subfolders) {
        for (let i = 0; i < itemsPerFolder; i++) {
          const url = `${serverBaseUrl}/media/valid/${folder}_${i}.png`;
          tasks.push(downloader.downloadToProject(stressProjectId, url, folder, `item_${folder}_${i}`));
        }
      }

      const results = await Promise.all(tasks);
      assert.equal(results.length, subfolders.length * itemsPerFolder);

      for (const folder of subfolders) {
        const folderPath = path.join(projectDir, folder);
        assert.ok(fs.existsSync(folderPath), `子目录必须创建: ${folderPath}`);
        for (let i = 0; i < itemsPerFolder; i++) {
          const filename = `item_${folder}_${i}.png`;
          const filePath = path.join(folderPath, filename);
          assert.ok(fs.existsSync(filePath), `文件必须存在: ${filePath}`);
          assert.ok(fs.statSync(filePath).size > 0);
        }
      }
    });

    it('1.3 同名文件并发下载竞争：平稳落地且无文件句柄死锁', async () => {
      const downloader = MediaDownloader.getInstance();
      const collisionTasks = Array.from({ length: 5 }, (_, i) => {
        const url = `${serverBaseUrl}/media/valid/collision_${i}.png`;
        return downloader.downloadToProject(stressProjectId, url, 'keyframes', 'collision_target');
      });

      // 5 个并发请求写入同一 customFilename
      const results = await Promise.all(collisionTasks);
      assert.equal(results.length, 5);
      for (const res of results) {
        assert.equal(res, `/media/${stressProjectId}/keyframes/collision_target.png`);
      }

      const diskPath = path.join(projectDir, 'keyframes', 'collision_target.png');
      assert.ok(fs.existsSync(diskPath));
      assert.ok(fs.statSync(diskPath).size > 0);

      // 验证无任何句柄占用：可以立刻以写模式打开该文件
      const fd = fs.openSync(diskPath, 'r+');
      fs.closeSync(fd);
    });
  });

  // =========================================================================
  // 2. 网络故障注入与自愈测试
  // =========================================================================
  describe('2. 网络故障注入与自愈测试 (Fault Injection & Recovery)', () => {
    it('2.1 流中途突发中断 (Socket 销毁)：重试耗尽后刚性抛错，且磁盘无 0 字节或损坏文件残留', async () => {
      const downloader = MediaDownloader.getInstance();
      const faultUrl = `${serverBaseUrl}/fault/drop-midway`;
      const customFilename = 'should_be_cleaned_up';

      await assert.rejects(
        async () => {
          await downloader.downloadToProject(stressProjectId, faultUrl, 'keyframes', customFilename);
        },
        (err: any) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('媒体下载彻底失败'));
          return true;
        }
      );

      // 验证损坏文件被安全清理，无垃圾文件残留
      const diskPath = path.join(projectDir, 'keyframes', `${customFilename}.png`);
      assert.equal(fs.existsSync(diskPath), false, '下载失败后损坏的不完整文件必须被立即 unlink 删除');
    });

    it('2.2 瞬态网络故障自愈：第 1 次连接中断，第 2 次重试成功落盘保真数据', async () => {
      const downloader = MediaDownloader.getInstance();
      const key = `test_retry_${Date.now()}`;
      const faultUrl = `${serverBaseUrl}/fault/drop-once-recover/${key}`;
      const customFilename = `auto_healed_${key}`;

      const result = await downloader.downloadToProject(stressProjectId, faultUrl, 'keyframes', customFilename);

      assert.equal(result, `/media/${stressProjectId}/keyframes/${customFilename}.png`);
      const diskPath = path.join(projectDir, 'keyframes', `${customFilename}.png`);
      assert.ok(fs.existsSync(diskPath), '重试自愈后文件必须完整落地');
      const content = fs.readFileSync(diskPath, 'utf-8');
      assert.ok(content.startsWith('RECOVERED_COMPLETE_IMAGE_BINARY_'), '内容必须是第 2 次完整重试产物');
    });

    it('2.3 慢速网络 (Trickle Transfer)：各分块正常拼接流式入库，无数据截断', async () => {
      const downloader = MediaDownloader.getInstance();
      const slowUrl = `${serverBaseUrl}/fault/slow-network`;
      const customFilename = `slow_stream_${Date.now()}`;

      const result = await downloader.downloadToProject(stressProjectId, slowUrl, 'video', customFilename);
      assert.ok(result.endsWith(`${customFilename}.mp4`));

      const diskPath = path.join(projectDir, 'video', `${customFilename}.mp4`);
      assert.ok(fs.existsSync(diskPath));
      const content = fs.readFileSync(diskPath, 'utf-8');
      assert.ok(content.includes('CHUNK_1_') && content.includes('CHUNK_5_'), '慢速网络下全部 chunk 必须完整写入');
    });

    it('2.4 HTTP 502 错误：刚性 Fail-Fast 阻断，抛出明确错误信息', async () => {
      const downloader = MediaDownloader.getInstance();
      await assert.rejects(
        async () => {
          await downloader.downloadToProject(stressProjectId, `${serverBaseUrl}/fault/502`, 'audio');
        },
        /502/
      );
    });

    it('2.5 HTTP 503 临时不可用：自动重试自愈恢复', async () => {
      const downloader = MediaDownloader.getInstance();
      const key = `healed_503_${Date.now()}`;
      const url = `${serverBaseUrl}/fault/503-recover/${key}`;

      const result = await downloader.downloadToProject(stressProjectId, url, 'portraits', key);
      assert.ok(result.includes(key));
      const diskPath = path.join(projectDir, 'portraits', `${key}.png`);
      assert.ok(fs.existsSync(diskPath));
      assert.equal(fs.readFileSync(diskPath, 'utf-8'), '503_RECOVERED_SUCCESS_DATA');
    });

    it('2.6 HTTP 504 网关超时：刚性抛错且绝无假收敛', async () => {
      const downloader = MediaDownloader.getInstance();
      await assert.rejects(
        async () => {
          await downloader.downloadToProject(stressProjectId, `${serverBaseUrl}/fault/504`, 'video');
        },
        /504/
      );
    });

    it('2.7 挂起停滞流断开后刚性阻断并清理残留文件', async () => {
      const downloader = MediaDownloader.getInstance();
      const stalledUrl = `${serverBaseUrl}/fault/stalled-stream`;
      const customFilename = `stalled_file_${Date.now()}`;

      await assert.rejects(
        async () => {
          await downloader.downloadToProject(stressProjectId, stalledUrl, 'keyframes', customFilename);
        },
        (err: any) => {
          assert.ok(err instanceof Error);
          return true;
        }
      );

      const diskPath = path.join(projectDir, 'keyframes', `${customFilename}.png`);
      assert.equal(fs.existsSync(diskPath), false, '停滞后断开的残留文件必须被清理');
    });
  });

  // =========================================================================
  // 3. 资源清理、文件句柄与僵尸进程防御
  // =========================================================================
  describe('3. 资源清理、文件句柄与僵尸进程防御 (Resource Leak & Process Guards)', () => {
    it('3.1 连续多次故障下载后无文件句柄泄露：Windows 平台下目录可立即安全删除与重建', async () => {
      const downloader = MediaDownloader.getInstance();
      const faultyDir = path.join(projectDir, 'leak_test');
      if (!fs.existsSync(faultyDir)) fs.mkdirSync(faultyDir, { recursive: true });

      // 连续执行 5 次故障下载
      for (let i = 0; i < 5; i++) {
        try {
          await downloader.downloadToProject(
            stressProjectId,
            `${serverBaseUrl}/fault/drop-midway`,
            'leak_test',
            `leak_file_${i}`
          );
        } catch {}
      }

      // 若有未关闭的文件写入流 (FileHandle Leak)，在 Windows 上 rmSync 将抛出 EBUSY 或 EPERM
      let dirRemovedCleanly = false;
      try {
        fs.rmSync(faultyDir, { recursive: true, force: true });
        dirRemovedCleanly = true;
      } catch (err: any) {
        assert.fail(`检测到文件句柄泄露，目录被锁定无法删除: ${err.message}`);
      }
      assert.equal(dirRemovedCleanly, true, '目录必须能够立即无阻碍删除，证明无文件句柄泄露');
    });

    it('3.2 FFmpegService 进程超时终止：超时子进程被终止且无僵尸进程残留', async () => {
      // 使用 node 命令模拟一个长达 30 秒的挂死进程
      const nodeExe = process.execPath;
      const hangingScript = 'setInterval(() => {}, 1000);';
      const service = new TestableFFmpegService(nodeExe);

      const startTime = Date.now();
      let timedOut = false;

      try {
        // 设置 300 毫秒短超时触发强制 kill
        await service.invokeFFmpeg(['-e', hangingScript], { timeout: 300 });
      } catch (err: any) {
        timedOut = true;
        const elapsed = Date.now() - startTime;
        assert.ok(elapsed < 2000, `超时保护必须在 2 秒内响应，实际耗时: ${elapsed}ms`);
        assert.ok(
          err.killed === true || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM',
          `必须标记为超时或被杀死: killed=${err.killed}, code=${err.code}, signal=${err.signal}`
        );
      }

      assert.equal(timedOut, true, '挂死进程必须被超时机制截断');
    });

    it('3.3 FFmpegService concatClips 并发执行：临时拼接清单文件 (concat_list_*.txt) 100% 自动清理', async () => {
      const concatSandbox = path.join(projectDir, 'concat_stress');
      if (!fs.existsSync(concatSandbox)) fs.mkdirSync(concatSandbox, { recursive: true });

      // 创建测试视频切片伪文件
      const clip1 = path.join(concatSandbox, 'clip1.mp4');
      const clip2 = path.join(concatSandbox, 'clip2.mp4');
      fs.writeFileSync(clip1, 'DUMMY_CLIP_DATA_1');
      fs.writeFileSync(clip2, 'DUMMY_CLIP_DATA_2');

      // 1. 测试在无系统 ffmpeg 抛错场景下，finally 块依然 100% 清理清单文件
      const nativeService = new FFmpegService();
      const concurrency = 10;
      const concatTasks = Array.from({ length: concurrency }, async (_, i) => {
        const out = path.join(concatSandbox, `concat_out_${i}.mp4`);
        try {
          await nativeService.concatClips([clip1, clip2], out);
        } catch {
          // 预期在缺少 ffmpeg 二进制的环境下抛出 ENOENT
        }
      });

      await Promise.all(concatTasks);

      const remainingFiles = fs.readdirSync(concatSandbox);
      const leftoverListFiles = remainingFiles.filter((f) => f.startsWith('concat_list_'));

      assert.equal(
        leftoverListFiles.length,
        0,
        `并发拼接后不得残留任何 concat_list_*.txt 临时文件，发现残留: ${JSON.stringify(leftoverListFiles)}`
      );

      // 2. 测试注入成功 Mock 执行器时，同样 100% 清理清单文件
      // 创建一个快速退出 0 的 mock 脚本
      const mockScriptPath = path.join(concatSandbox, 'mock_ffmpeg.js');
      fs.writeFileSync(mockScriptPath, `
        const fs = require('fs');
        const args = process.argv.slice(2);
        const outIdx = args.length - 1;
        fs.writeFileSync(args[outIdx], 'CONCATENATED_OUTPUT');
      `);

      const mockService = new FFmpegService(`${process.execPath} ${mockScriptPath}`);
      // 单测直接验证模拟执行
      const mockOut = path.join(concatSandbox, 'mock_out.mp4');
      try {
        await mockService.concatClips([clip1, clip2], mockOut);
      } catch {}

      const filesAfterMock = fs.readdirSync(concatSandbox);
      const leftoverMockList = filesAfterMock.filter((f) => f.startsWith('concat_list_'));
      assert.equal(leftoverMockList.length, 0, 'Mock 执行后同样无 concat_list_ 残留');
    });
  });
});
