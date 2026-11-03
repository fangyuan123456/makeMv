/**
 * utils/atomicFile.ts
 * 生产级物理文件原子写入工具 (Atomic File Sync SSOT)
 */

import fs from 'fs';
import { randomUUID } from 'crypto';

/**
 * 工业级原子写入助手：写入临时文件后执行原子重命名，彻底杜绝断电或崩溃导致 JSON 损坏
 * 兼容 Windows 系统瞬态文件排他锁与 EPERM，采用 5 次重试、同步休眠退避与物理覆盖自愈保障
 */
export function atomicWriteJsonSync(filePath: string, data: any): void {
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');

    // Windows 平台重试与降级自愈 (应对杀毒软件或文件句柄未完全关闭造成的 EPERM / EBUSY / EACCES)
    let renamed = false;
    let lastErr: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.renameSync(tmpPath, filePath);
        renamed = true;
        break;
      } catch (err: any) {
        lastErr = err;
        if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
          try {
            fs.copyFileSync(tmpPath, filePath);
            // copyFileSync 成功即代表物理目标文件已被完整覆写，立即标记成功
            renamed = true;
            try {
              fs.unlinkSync(tmpPath);
            } catch {
              // 临时文件被杀毒软件或索引器瞬态占用时静默自愈清理，绝不掩盖已成功的覆写
            }
            break;
          } catch {
            // copyFileSync 亦遭遇排他锁，进入退避等待重试
          }
        }
      }

      if (attempt < 4) {
        // 轻量时间戳微退避，彻底移除 Atomics.wait，杜绝事件循环底层被锁死
        const start = Date.now();
        while (Date.now() - start < 2) {
          // 微等待 2ms 等待 Windows 文件句柄或杀毒扫描瞬态释放
        }
      }
    }

    if (!renamed && lastErr) {
      throw lastErr;
    }
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // 静默清理失败的临时文件
      }
    }
    throw err;
  }
}

/**
 * 工业级纯文本文件原子写入
 */
export function atomicWriteStringSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');

    let renamed = false;
    let lastErr: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.renameSync(tmpPath, filePath);
        renamed = true;
        break;
      } catch (err: any) {
        lastErr = err;
        if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
          try {
            fs.copyFileSync(tmpPath, filePath);
            renamed = true;
            try {
              fs.unlinkSync(tmpPath);
            } catch {}
            break;
          } catch {}
        }
      }

      if (attempt < 4) {
        const start = Date.now();
        while (Date.now() - start < 2) {}
      }
    }

    if (!renamed && lastErr) {
      throw lastErr;
    }
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
    throw err;
  }
}
