/**
 * MediaSecurityFuzz.test.ts
 * 媒体资产安全边界与对抗性模糊测试套件 (Adversarial Fuzzing & Security Invariants SSOT)
 *
 * 覆盖维度 (EMPIRICAL VERIFICATION):
 * 1. 极端路径穿越攻击 (Extreme Path Traversal Payloads in customFilename & subfolder):
 *    - ../../../../../../../../Windows/System32/drivers/etc/hosts
 *    - URL 编码穿越: %2e%2e%2f, %252e%252e%252f
 *    - Windows 反斜杠穿越: ..\\..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts
 *    - 空字节截断攻击: \0, test\0.png, \0../../escape
 *    - Windows 备用数据流 (ADS): image.png:stream, image.png::$DATA
 *    - Windows 保留设备名称: CON, PRN, AUX, NUL, COM1..9, LPT1..9
 *    - 纯点序列与空格: ., .., ..., ......, '   ', '\t\r\n'
 *    - 极端超长文件名 (255+ 字符)
 * 2. 畸形子目录攻击 (Malformed Subfolder Names):
 *    - 根斜杠与反斜杠: /, //, \\, \\\\
 *    - 点号穿越: ., .., ...
 *    - 空格与控制字符: '   ', '\0'
 *    - 盘符根目录: C:, C:\, D:\
 * 3. 恶意与异常协议 URL (Malicious & Exotic URLs):
 *    - 危险协议: javascript:, data:, ftp:, file:, ldap:, blob:
 *    - 相对与无协议 URL: /images/test.png, //attacker.com/evil, ../test.png
 *    - 畸形 HTTP URL: http://, https://, http:, http//foo, http://[::1]:999999
 * 4. VisualMediaRenderer 对抗性输入防御:
 *    - 角色定妆照、分镜关键帧、视频切片输入对抗载荷 (穿越串、空字节、特殊符号、非法时长与分辨率)
 *    - 恶意 Provider 返回值阻断与降级自愈
 * 5. 刚性全局不变量验证 (Strict Global Invariant):
 *    - 确保绝对没有任何文件逃逸出 data/test_projects/:projectId 物理隔离区
 *    - 确保无未捕获异常导致 Node.js 进程崩溃
 */

import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { AddressInfo } from 'net';
import { MediaDownloader } from '../../src/media/MediaDownloader.js';
import { VisualMediaRenderer } from '../../src/media/VisualMediaRenderer.js';
import { MediaProviderFactory } from '../../src/media/providers/MediaProviderFactory.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { config } from '../../src/utils/config.js';
import { SessionStatus, WorkflowStage } from '../../src/types/index.js';

describe('MediaSecurityFuzz 媒体下载与视听渲染安全边界模糊测试套件', () => {
  const fuzzProjectId = 'test_security_fuzz_sandbox';
  const projectDir = path.resolve(config.paths.projects, fuzzProjectId);
  const productionProjectsDir = path.resolve(process.cwd(), 'data', 'projects');

  let testServer: http.Server;
  let testServerBaseUrl: string;

  // 测试有效测试载荷数据
  const safePayload = Buffer.from('SAFE_IMAGE_BINARY_PAYLOAD_FOR_FUZZ_TESTING');

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
      projectId: fuzzProjectId,
      title: '安全边界模糊测试沙箱工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '安全边界模糊单测', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });

    // 2. 启动本地轻量 HTTP 服务器，专门供应测试数据
    testServer = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      if (url.pathname === '/valid.png') {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': String(safePayload.length),
        });
        res.end(safePayload);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => {
      testServer.listen(0, '127.0.0.1', () => {
        const address = testServer.address() as AddressInfo;
        testServerBaseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    MediaProviderFactory.reset();

    // 优雅关闭 HTTP 服务器 (防止 keep-alive 句柄导致挂死)
    if (testServer) {
      if (typeof (testServer as any).closeAllConnections === 'function') {
        (testServer as any).closeAllConnections();
      }
      await new Promise<void>((resolve) => {
        testServer.close(() => resolve());
      });
    }

    // 清理沙箱工程
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

  // =========================================================================
  // 1. customFilename 极端路径穿越载荷对抗与物理沙箱拘束
  // =========================================================================
  describe('1. customFilename 极端路径穿越载荷对抗与沙箱拘束', () => {
    const adversarialFilenames = [
      '../../../../../../../../Windows/System32/drivers/etc/hosts',
      '..\\..\\..\\..\\..\\..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts',
      '%2e%2e%2f%2e%2e%2f%2e%2e%2fWindows%2fSystem32%2fdrivers%2fetc%2fhosts',
      '..%2f..%2f..%2f..%2fetc%2fpasswd',
      '%252e%252e%252f%252e%252e%252fetc%252fpasswd',
      '/etc/passwd',
      '/var/log/syslog',
      'C:\\Windows\\System32\\cmd.exe',
      'C:/Windows/System32/cmd.exe',
      '\\\\attacker.server\\share\\evil.png',
      '//attacker.server/share/evil.png',
      'payload.png:secret.txt',
      'payload.png::$DATA',
      'evil\0.png',
      '\0../../escape',
      'normal_\x00_filename.png',
      '.',
      '..',
      '...',
      '......',
      '   ',
      ' \t\r\n ',
      'test:*?"<>|file.png',
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'LPT1',
      'CON.png',
      'aux.mp4',
      'NUL.txt',
      '\uff0e\uff0e\uff0fetc\uff0fpasswd', // 全角双点与斜杠
      '\u2024\u2024\u2215Windows', // Unicode 字符变体
      'A'.repeat(500) + '.png', // 超长文件名
    ];

    for (let i = 0; i < adversarialFilenames.length; i++) {
      const payload = adversarialFilenames[i];
      const displayPayload = JSON.stringify(payload);

      it(`1.${i + 1} customFilename 对抗测试: ${displayPayload}`, async () => {
        const downloader = MediaDownloader.getInstance();
        const validUrl = `${testServerBaseUrl}/valid.png`;

        let resultPath: string | undefined;
        let threwError = false;

        try {
          resultPath = await downloader.downloadToProject(
            fuzzProjectId,
            validUrl,
            'keyframes',
            payload
          );
        } catch (err: any) {
          threwError = true;
          // 若抛错，必须是受控的 Error（如路径穿越检测或文件系统保护抛错），绝不能是未捕获系统崩溃
          assert.ok(err instanceof Error, `抛出的必须为标准 Error 实例: ${err}`);
        }

        // 若成功返回本地路径
        if (resultPath) {
          // 1. 标准化路径必须以 /media/:projectId/ 开头
          assert.ok(
            resultPath.startsWith(`/media/${fuzzProjectId}/`),
            `标准化路径必须拘束于当前项目前缀: ${resultPath}`
          );

          // 2. 路径中严禁出现 .. 或反斜杠 \\ 或空字节
          assert.ok(!resultPath.includes('..'), `返回路径严禁包含 .. 逃逸序列: ${resultPath}`);
          assert.ok(!resultPath.includes('\\'), `返回路径严禁包含反斜杠: ${resultPath}`);
          assert.ok(!resultPath.includes('\0'), `返回路径严禁包含空字节: ${resultPath}`);

          // 3. 物理文件必须真实存在于 projectDir 内部
          const relativePart = resultPath.replace(`/media/${fuzzProjectId}/`, '');
          const diskPath = path.resolve(projectDir, relativePart);

          assert.ok(
            diskPath.startsWith(path.resolve(projectDir) + path.sep),
            `物理文件必须严格拘束于沙箱内: ${diskPath}`
          );
          assert.ok(fs.existsSync(diskPath), `物理落盘文件必须存在: ${diskPath}`);
          assert.ok(fs.statSync(diskPath).size > 0, '文件大小必须大于 0');
        }

        // 4. 关键安全不变量：验证系统根与外部目录绝未被写入
        assert.equal(
          fs.existsSync(path.resolve(process.cwd(), 'hosts')),
          false,
          '严禁污染当前工作区根目录 (hosts)'
        );
        assert.equal(
          fs.existsSync(path.resolve(process.cwd(), 'passwd')),
          false,
          '严禁污染当前工作区根目录 (passwd)'
        );
        assert.equal(
          fs.existsSync(path.resolve(productionProjectsDir, 'hosts')),
          false,
          '严禁污染生产工程目录'
        );
      });
    }
  });

  // =========================================================================
  // 2. subfolder 畸形与穿越攻击对抗
  // =========================================================================
  describe('2. subfolder 畸形与穿越攻击对抗', () => {
    const adversarialSubfolders = [
      '/',
      '//',
      '///',
      '\\',
      '\\\\',
      '..',
      '../',
      '../../',
      '../../../../../../Windows/System32',
      '..\\..\\..\\..\\Windows\\System32',
      '%2e%2e%2f',
      '.',
      '...',
      '   ',
      '\t\r\n',
      'sub\0folder',
      '\0',
      'C:',
      'C:\\',
      'C:/',
      'D:\\',
      'CON',
      'AUX',
      'NUL',
      'keyframes:hidden_stream',
      'a'.repeat(200),
    ];

    for (let i = 0; i < adversarialSubfolders.length; i++) {
      const subfolderPayload = adversarialSubfolders[i];
      const displayPayload = JSON.stringify(subfolderPayload);

      it(`2.${i + 1} subfolder 对抗测试: ${displayPayload}`, async () => {
        const downloader = MediaDownloader.getInstance();
        const validUrl = `${testServerBaseUrl}/valid.png`;

        let resultPath: string | undefined;
        try {
          resultPath = await downloader.downloadToProject(
            fuzzProjectId,
            validUrl,
            subfolderPayload,
            `fuzz_sub_${i}`
          );
        } catch (err: any) {
          // 刚性阻断抛错属于合规防御
          assert.ok(err instanceof Error);
        }

        if (resultPath) {
          // 返回路径必须严格拘束于 /media/:projectId/
          assert.ok(resultPath.startsWith(`/media/${fuzzProjectId}/`));
          assert.ok(!resultPath.includes('..'));
          assert.ok(!resultPath.includes('\\'));
          assert.ok(!resultPath.includes('\0'));

          const relativePart = resultPath.replace(`/media/${fuzzProjectId}/`, '');
          const diskPath = path.resolve(projectDir, relativePart);

          // 物理文件绝对不能超出 projectDir
          assert.ok(
            diskPath.startsWith(path.resolve(projectDir) + path.sep) ||
            diskPath === path.resolve(projectDir),
            `物理文件必须严格拘束在沙箱内: ${diskPath}`
          );
          assert.ok(fs.existsSync(diskPath));
        }

        // 验证父级与全局沙箱安全
        assert.equal(
          fs.existsSync(path.resolve(config.paths.projects, `fuzz_sub_${i}.png`)),
          false,
          '绝对严禁逃逸至 projects 根目录'
        );
      });
    }
  });

  // =========================================================================
  // 3. 恶意与畸形 URL 协议安全防护
  // =========================================================================
  describe('3. 恶意与畸形 URL 协议安全防护', () => {
    it('3.1 javascript: 恶意伪协议：安全跳过返回原值，绝对不得发起 fetch 或写盘', async () => {
      let fetchCalled = false;
      mock.method(globalThis as any, 'fetch', async () => {
        fetchCalled = true;
        return new Response('evil');
      });

      const downloader = MediaDownloader.getInstance();
      const jsUrl = 'javascript:alert(document.domain)';
      const result = await downloader.downloadToProject(fuzzProjectId, jsUrl, 'video');

      assert.equal(result, jsUrl, 'javascript: 协议必须直接安全返回原值');
      assert.equal(fetchCalled, false, '绝不得调用 fetch');
    });

    it('3.2 data: 协议 (SVG XSS / HTML)：安全跳过返回原值', async () => {
      let fetchCalled = false;
      mock.method(globalThis as any, 'fetch', async () => {
        fetchCalled = true;
        return new Response('evil');
      });

      const downloader = MediaDownloader.getInstance();
      const dataSvg = 'data:image/svg+xml;utf8,<svg onload=alert(1)>';
      const result = await downloader.downloadToProject(fuzzProjectId, dataSvg, 'keyframes');

      assert.equal(result, dataSvg);
      assert.equal(fetchCalled, false);
    });

    it('3.3 ftp: 协议：安全跳过返回原值', async () => {
      const downloader = MediaDownloader.getInstance();
      const ftpUrl = 'ftp://attacker.com/exploit.png';
      const result = await downloader.downloadToProject(fuzzProjectId, ftpUrl, 'covers');
      assert.equal(result, ftpUrl);
    });

    it('3.4 file: 协议 (本地文件读取攻击)：安全直通原值，严禁流式写入覆盖沙箱', async () => {
      const downloader = MediaDownloader.getInstance();
      const localFileUrl = 'file:///C:/Windows/System32/drivers/etc/hosts';
      const result = await downloader.downloadToProject(fuzzProjectId, localFileUrl, 'portraits');
      assert.equal(result, localFileUrl);
    });

    it('3.5 相对路径与伪路径：安全跳过返回原值', async () => {
      const downloader = MediaDownloader.getInstance();
      assert.equal(await downloader.downloadToProject(fuzzProjectId, '/images/test.png', 'video'), '/images/test.png');
      assert.equal(await downloader.downloadToProject(fuzzProjectId, '../images/test.png', 'video'), '../images/test.png');
      assert.equal(await downloader.downloadToProject(fuzzProjectId, '//attacker.com/evil.png', 'video'), '//attacker.com/evil.png');
      assert.equal(await downloader.downloadToProject(fuzzProjectId, 'local_relative.jpg', 'video'), 'local_relative.jpg');
    });

    it('3.6 畸形 URL 协议 (http://, https://, http:, http//foo)：刚性 Fail-Fast 阻断且无未捕获崩溃', async () => {
      const downloader = MediaDownloader.getInstance();
      const malformedUrls = [
        'http://',
        'https://',
        'http:',
        'http//example.com',
        'http:/example.com',
        'httpx://example.com',
        'http://[::1]:999999/test.png',
        'http://127.0.0.1:0/test.png',
        'https://nonexistent-domain-fuzz-testing-2026.make-mv.local/media.png',
      ];

      for (const badUrl of malformedUrls) {
        if (!badUrl.startsWith('http://') && !badUrl.startsWith('https://')) {
          // 非 http(s) 协议安全原样返回
          const res = await downloader.downloadToProject(fuzzProjectId, badUrl, 'video');
          assert.equal(res, badUrl);
        } else {
          // 畸形 http(s) 必须刚性抛出 Error，绝不允许静默假收敛或进程崩溃
          await assert.rejects(
            async () => {
              await downloader.downloadToProject(fuzzProjectId, badUrl, 'video');
            },
            (err: any) => {
              assert.ok(err instanceof Error);
              assert.ok(err.message.includes('MediaDownloader') || err.message.includes('失败'));
              return true;
            },
            `畸形 URL ${badUrl} 必须被刚性 Fail-Fast 捕获拦截`
          );
        }
      }
    });

    it('3.7 downloadMedia 契约映射方法入参对抗对齐', async () => {
      const downloader = MediaDownloader.getInstance();
      const ftpUrl = 'ftp://test.org/image.png';
      const result = await downloader.downloadMedia(ftpUrl, fuzzProjectId, 'keyframes');
      assert.equal(result, ftpUrl);
    });
  });

  // =========================================================================
  // 4. VisualMediaRenderer 对抗性输入防御与自愈降级
  // =========================================================================
  describe('4. VisualMediaRenderer 对抗性输入防御与自愈降级', () => {
    it('4.1 renderCharacterPortrait：恶意角色名包含路径穿越及非法字符，文件名被安全清洗', async () => {
      const maliciousNames = [
        '../../../../Windows/System32/drivers/etc/hosts',
        '..\\..\\..\\calc',
        'Hero\0Villain',
        '<script>alert("XSS")</script>',
        'CON',
        '   ',
        '诸葛孔明 100% 顶级主角 \u{1F3AC}',
      ];

      for (const charName of maliciousNames) {
        const renderResult = await VisualMediaRenderer.renderCharacterPortrait(
          fuzzProjectId,
          charName,
          undefined,
          { isMock: true }
        );

        assert.ok(
          renderResult.url.startsWith(`/media/${fuzzProjectId}/characters/`),
          `返回必须为标准 /media/:projectId/characters/ 格式: ${renderResult.url}`
        );
        assert.ok(!renderResult.url.includes('..'), '绝不得包含 .. 逃逸');
        assert.ok(!renderResult.url.includes('\\'), '绝不得包含反斜杠');
        assert.ok(!renderResult.url.includes('\0'), '绝不得包含空字节');

        const relPath = renderResult.url.replace(`/media/${fuzzProjectId}/`, '');
        const diskFile = path.resolve(projectDir, relPath);

        assert.ok(diskFile.startsWith(path.resolve(projectDir) + path.sep));
        assert.ok(fs.existsSync(diskFile), `物理文件必须真实存在: ${diskFile}`);
        assert.ok(fs.statSync(diskFile).size > 0);
      }
    });

    it('4.2 renderKeyframeImage：恶意 shotId 包含路径穿越，被下划线安全清洗', async () => {
      const maliciousShots = [
        '../../../../shot_escape',
        '..\\..\\win_escape',
        'shot:001*angle?tag',
        '\0shot_null',
        '   ',
      ];

      for (const shot of maliciousShots) {
        const renderResult = await VisualMediaRenderer.renderKeyframeImage(
          fuzzProjectId,
          shot,
          '16:9',
          undefined,
          { isMock: true }
        );

        assert.ok(renderResult.url.startsWith(`/media/${fuzzProjectId}/keyframes/`));
        assert.ok(!renderResult.url.includes('..'));
        assert.ok(!renderResult.url.includes('\\'));

        const relPath = renderResult.url.replace(`/media/${fuzzProjectId}/`, '');
        const diskFile = path.resolve(projectDir, relPath);

        assert.ok(diskFile.startsWith(path.resolve(projectDir) + path.sep));
        assert.ok(fs.existsSync(diskFile));
        assert.ok(fs.statSync(diskFile).size > 0);
      }
    });

    it('4.3 renderVideoClip：恶意 clipId 及异常时长、分辨率，安全容错生成合法 MP4', async () => {
      const renderResult = await VisualMediaRenderer.renderVideoClip(
        fuzzProjectId,
        '../../../../clip_escape',
        'shot_99',
        -10, // 异常负数时长
        'INVALID_8K_RESOLUTION', // 异常分辨率
        'INVALID_ASPECT_RATIO', // 异常画幅
        undefined,
        undefined,
        { isMock: true }
      );

      assert.ok(renderResult.url.startsWith(`/media/${fuzzProjectId}/video/`));
      assert.ok(!renderResult.url.includes('..'));
      assert.ok(renderResult.url.endsWith('.mp4'));

      const relPath = renderResult.url.replace(`/media/${fuzzProjectId}/`, '');
      const diskFile = path.resolve(projectDir, relPath);

      assert.ok(diskFile.startsWith(path.resolve(projectDir) + path.sep));
      assert.ok(fs.existsSync(diskFile));
      assert.ok(fs.statSync(diskFile).size > 0);
    });

    it('4.4 恶意 Provider 返回对抗性 URL 时 VisualMediaRenderer 平稳自愈降级', async () => {
      // 模拟 Provider 返回不可达或畸形 URL
      MediaProviderFactory.setImageProvider({
        name: 'malicious-url-provider',
        generateImage: async () => 'https://invalid-fuzz-target.domain.test/404.jpg',
      });

      mock.method(globalThis as any, 'fetch', async () => {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      });

      // 验证降级为本地预演并标记 isDegraded = true，绝不导致顶层未捕获崩溃
      const result = await VisualMediaRenderer.renderCharacterPortrait(
        fuzzProjectId,
        '降级自愈角色',
        '测试提示词'
      );

      assert.equal(result.isDegraded, true);
      assert.ok(result.degradedReason?.includes('未收敛') || result.degradedReason?.includes('失败'));
      assert.ok(result.url.startsWith(`/media/${fuzzProjectId}/characters/`));

      const diskFile = path.resolve(projectDir, result.url.replace(`/media/${fuzzProjectId}/`, ''));
      assert.ok(fs.existsSync(diskFile));
      assert.ok(fs.statSync(diskFile).size > 0);
    });
  });

  // =========================================================================
  // 5. 严格全局沙箱隔离与零逃逸验证 (Strict Zero-Escape Invariants)
  // =========================================================================
  describe('5. 严格全局沙箱隔离与零逃逸验证', () => {
    it('5.1 零文件逃逸验证：递归扫描沙箱外部，确认无任何外溢测试脏文件', () => {
      // 1. 验证工作区根目录无任何 *.png, *.jpg, *.mp4 逃逸
      const workspaceRoot = process.cwd();
      const rootFiles = fs.readdirSync(workspaceRoot);
      const leakedMedia = rootFiles.filter((f) => /\.(png|jpg|jpeg|mp4|mp3|txt)$/i.test(f));
      assert.equal(
        leakedMedia.length,
        0,
        `工作区根目录发现媒体逃逸文件: ${JSON.stringify(leakedMedia)}`
      );

      // 2. 验证真实生产 projects 目录无任何 fuzz 测试数据
      if (fs.existsSync(productionProjectsDir)) {
        const prodEntries = fs.readdirSync(productionProjectsDir);
        assert.ok(
          !prodEntries.includes(fuzzProjectId),
          `生产 projects 目录中严禁包含模糊测试工程: ${fuzzProjectId}`
        );
      }

      // 3. 验证沙箱内所有文件严格位于沙箱根路径下
      function walkDir(currentDir: string): string[] {
        let results: string[] = [];
        const list = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const dirent of list) {
          const fullPath = path.join(currentDir, dirent.name);
          if (dirent.isDirectory()) {
            results = results.concat(walkDir(fullPath));
          } else {
            results.push(fullPath);
          }
        }
        return results;
      }

      const allSandboxFiles = walkDir(projectDir);
      for (const filePath of allSandboxFiles) {
        assert.ok(
          filePath.startsWith(path.resolve(projectDir) + path.sep),
          `发现非法路径跨越文件: ${filePath}`
        );
      }
    });
  });
});
