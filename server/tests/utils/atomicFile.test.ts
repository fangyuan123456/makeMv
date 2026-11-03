/**
 * atomicFile.test.ts
 * 生产级物理文件原子写入独立单元测试套件 (Atomic File Sync Unit Tests)
 *
 * 测试矩阵：
 * 1. 正常原子写入与文件保真度（基础数据、深层嵌套、文件覆盖、零 .tmp 残留）
 * 2. 破坏性边界与快速失败（循环引用快速抛错、不存在的目录、零孤儿临时文件残留）
 * 3. Windows 平台文件排他锁与自愈降级对抗（模拟 EPERM 降级 copyFileSync、模拟临时文件被杀毒锁定 unlink 抛错自愈、瞬态锁退避重试成功、持续锁定刚性抛错）
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '../../src/utils/atomicFile.js';
import { config } from '../../src/utils/config.js';

describe('atomicFile 物理文件原子写入与 Windows 防锁对抗测试', () => {
  const sandboxDir = path.resolve(config.paths.projects, 'test_atomic_file_sandbox');

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
  // 1. 正常原子写入与数据保真度
  // =========================================================================
  describe('1. 正常原子写入与数据保真度', () => {
    it('1.1 基础 JSON 对象原子落盘：内容保真且绝对无 .tmp 临时文件残留', () => {
      const targetFile = path.join(sandboxDir, 'basic_atomic.json');
      const payload = {
        title: '原子写入测试',
        version: 1,
        active: true,
        tags: ['windows', 'concurrency', '原子化'],
        nested: { innerKey: 'deepValue', timestamp: Date.now() },
      };

      atomicWriteJsonSync(targetFile, payload);

      assert.ok(fs.existsSync(targetFile), '目标文件必须成功落盘');
      const raw = fs.readFileSync(targetFile, 'utf-8');
      const parsed = JSON.parse(raw);
      assert.deepEqual(parsed, payload, '落盘内容必须与原始 payload 严格深度相等');

      // 验证格式化为 2 空格缩进
      assert.ok(raw.includes('\n  "title": "原子写入测试"'), '必须遵循 2 格缩进格式');

      // 检查沙箱中绝无残留的 .tmp 临时文件
      const danglingTmp = fs.readdirSync(sandboxDir).filter((f) => f.includes('basic_atomic') && f.endsWith('.tmp'));
      assert.equal(danglingTmp.length, 0, '成功写入后绝不允许残留 .tmp 临时文件');
    });

    it('1.2 目标文件已存在时原子覆盖：旧内容被彻底覆写且过程无中间损坏态', () => {
      const targetFile = path.join(sandboxDir, 'overwrite_target.json');

      // 阶段 1: 写入初代数据
      atomicWriteJsonSync(targetFile, { version: 1, state: 'initial' });
      assert.equal(JSON.parse(fs.readFileSync(targetFile, 'utf-8')).version, 1);

      // 阶段 2: 覆盖写入新数据
      const updatedPayload = { version: 2, state: 'migrated', extra: 'new_feature' };
      atomicWriteJsonSync(targetFile, updatedPayload);

      const finalParsed = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      assert.deepEqual(finalParsed, updatedPayload, '覆盖写入后必须完整呈现新版本数据');
    });

    it('1.3 巨型复杂对象 (~1MB) 原子落盘保真度', () => {
      const targetFile = path.join(sandboxDir, 'giant_atomic.json');
      const characters = Array.from({ length: 500 }, (_, i) => ({
        id: `char_${i}`,
        name: `角色_${i}`,
        bio: '详细人物生平描述，包含多段转折与心理活动。'.repeat(10),
      }));

      atomicWriteJsonSync(targetFile, { characters });

      assert.ok(fs.existsSync(targetFile));
      const readBack = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      assert.equal(readBack.characters.length, 500);
      assert.equal(readBack.characters[499].id, 'char_499');
    });
  });

  // =========================================================================
  // 2. 异常输入与快速失败 (Fail-Fast)
  // =========================================================================
  describe('2. 异常输入与快速失败 (Fail-Fast)', () => {
    it('2.1 循环引用对象序列化失败：刚性抛错且绝不在磁盘留下目标文件或 .tmp 残留', () => {
      const targetFile = path.join(sandboxDir, 'circular_error.json');
      const circular: any = { name: 'circular_test' };
      circular.self = circular;

      assert.throws(
        () => atomicWriteJsonSync(targetFile, circular),
        /Converting circular structure to JSON/
      );

      assert.ok(!fs.existsSync(targetFile), '序列化失败时严禁创建目标文件');
      const danglingTmp = fs.readdirSync(sandboxDir).filter((f) => f.includes('circular_error'));
      assert.equal(danglingTmp.length, 0, '序列化失败时必须自动清理或不生成任何临时文件');
    });

    it('2.2 无效/不存在的目标目录：刚性抛出 ENOENT 并安全自愈清理', () => {
      const invalidPath = path.join(sandboxDir, 'non_existent_folder_xyz', 'test.json');

      assert.throws(() => atomicWriteJsonSync(invalidPath, { test: true }), /ENOENT/);
    });
  });

  // =========================================================================
  // 3. Windows 平台锁对抗与降级自愈 (Windows Concurrency & Self-Healing)
  // =========================================================================
  describe('3. Windows 平台锁对抗与降级自愈', () => {
    it('3.1 模拟 fs.renameSync 抛出 EPERM：成功触发 copyFileSync 降级自愈并正确落盘', () => {
      const targetFile = path.join(sandboxDir, 'mock_eperm_fallback.json');
      const payload = { mode: 'fallback_success', code: 'EPERM_HEALED' };

      const origRename = fs.renameSync;
      let renameCallCount = 0;

      try {
        // 猴子补丁：模拟 Windows 下文件句柄占用导致的 EPERM
        fs.renameSync = (oldPath, newPath) => {
          renameCallCount++;
          const err: any = new Error('operation not permitted (mock EPERM on Windows)');
          err.code = 'EPERM';
          throw err;
        };

        atomicWriteJsonSync(targetFile, payload);

        // 验证：虽然 renameSync 抛出 EPERM，但通过 copyFileSync 成功写入目标文件
        assert.ok(renameCallCount >= 1, '必须尝试过 renameSync');
        assert.ok(fs.existsSync(targetFile), '降级后目标文件必须真实存在于磁盘');
        const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
        assert.deepEqual(parsed, payload, '降级 copyFileSync 写入的数据必须完好无损');
      } finally {
        fs.renameSync = origRename;
      }
    });

    it('3.2 模拟 fs.renameSync 抛出 EBUSY 且临时文件被杀毒软件锁定 (unlinkSync 抛出 EPERM)：绝不误判失败', () => {
      const targetFile = path.join(sandboxDir, 'mock_ebusy_tmp_locked.json');
      const payload = { mode: 'isolated_unlink_catch', defenderLocked: true };

      const origRename = fs.renameSync;
      const origUnlink = fs.unlinkSync;
      let unlinkAttempted = false;

      try {
        // 1. rename 抛出 EBUSY
        fs.renameSync = () => {
          const err: any = new Error('resource busy or locked (mock EBUSY)');
          err.code = 'EBUSY';
          throw err;
        };

        // 2. copyFileSync 成功后，模拟杀毒软件正在扫描刚生成的 .tmp 文件，unlink 抛出 EPERM
        fs.unlinkSync = (targetPath) => {
          if (typeof targetPath === 'string' && targetPath.endsWith('.tmp')) {
            unlinkAttempted = true;
            const err: any = new Error('operation not permitted (Defender scanning .tmp)');
            err.code = 'EPERM';
            throw err;
          }
          return origUnlink(targetPath);
        };

        // 核心断言：由于 copyFileSync 已成功，unlinkSync 处于独立 try-catch 自愈中，系统绝不得向外抛错
        assert.doesNotThrow(() => {
          atomicWriteJsonSync(targetFile, payload);
        });

        assert.ok(unlinkAttempted, '必须尝试清理临时文件');
        assert.ok(fs.existsSync(targetFile), '目标文件必须成功落地');
        const readBack = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
        assert.deepEqual(readBack, payload, '目标文件必须成功获得完整数据');
      } finally {
        fs.renameSync = origRename;
        fs.unlinkSync = origUnlink;
      }
    });

    it('3.3 模拟瞬态锁定：前 2 次遭遇 EACCES，第 3 次在退避后恢复成功', () => {
      const targetFile = path.join(sandboxDir, 'mock_transient_retry.json');
      const payload = { transient: true, recoveredAttempt: 3 };

      const origRename = fs.renameSync;
      const origCopy = fs.copyFileSync;
      let attempts = 0;

      try {
        fs.renameSync = (oldP, newP) => {
          attempts++;
          if (attempts <= 2) {
            const err: any = new Error('access denied (transient lock)');
            err.code = 'EACCES';
            throw err;
          }
          return origRename(oldP, newP);
        };

        fs.copyFileSync = (src, dest) => {
          if (attempts <= 2) {
            const err: any = new Error('access denied (transient lock on copy)');
            err.code = 'EACCES';
            throw err;
          }
          return origCopy(src, dest);
        };

        atomicWriteJsonSync(targetFile, payload);

        assert.equal(attempts, 3, '必须经过 2 次重试并在第 3 次成功');
        assert.ok(fs.existsSync(targetFile));
        assert.deepEqual(JSON.parse(fs.readFileSync(targetFile, 'utf-8')), payload);
      } finally {
        fs.renameSync = origRename;
        fs.copyFileSync = origCopy;
      }
    });

    it('3.4 模拟不可恢复的极端锁竞争：持续 5 次重试耗尽后刚性抛错，绝不静默吞错', () => {
      const targetFile = path.join(sandboxDir, 'mock_persistent_failure.json');
      const origRename = fs.renameSync;
      const origCopy = fs.copyFileSync;
      let renameTries = 0;
      let copyTries = 0;

      try {
        fs.renameSync = () => {
          renameTries++;
          const err: any = new Error('persistent EBUSY');
          err.code = 'EBUSY';
          throw err;
        };

        fs.copyFileSync = () => {
          copyTries++;
          const err: any = new Error('persistent EBUSY on copy');
          err.code = 'EBUSY';
          throw err;
        };

        assert.throws(
          () => atomicWriteJsonSync(targetFile, { willFail: true }),
          /persistent EBUSY/
        );

        assert.equal(renameTries, 5, '必须重试满 5 次');
        assert.equal(copyTries, 5, '每次重试都应尝试过降级 copyFileSync');
        assert.ok(!fs.existsSync(targetFile), '完全失败时不得产生半成品目标文件');
      } finally {
        fs.renameSync = origRename;
        fs.copyFileSync = origCopy;
      }
    });
  });
});
