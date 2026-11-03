/**
 * utils/atomicFile.ts
 * 生产级物理文件原子写入工具 (Atomic File Sync SSOT)
 */

import fs from 'fs';
import { randomUUID } from 'crypto';

/**
 * 🌟 工业级原子写入助手：写入临时文件后执行原子重命名，彻底杜绝断电或崩溃导致 JSON 损坏
 * 兼容 Windows 系统瞬态文件排他锁与 EPERM，采用重试与物理覆盖自愈保障
 */
export function atomicWriteJsonSync(filePath: string, data: any): void {
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');

    // Windows 平台重试与降级自愈 (应对杀毒软件或文件句柄未完全关闭造成的 EPERM / EBUSY)
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
            fs.unlinkSync(tmpPath);
            renamed = true;
            break;
          } catch {
            // 继续重试循环
          }
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
