/**
 * utils/atomicFile.ts
 * 生产级物理文件原子写入工具 (Atomic File Sync SSOT)
 */

import fs from 'fs';
import { randomUUID } from 'crypto';

/**
 * 🌟 工业级原子写入助手：写入临时文件后执行原子重命名，彻底杜绝断电或崩溃导致 JSON 损坏
 */
export function atomicWriteJsonSync(filePath: string, data: any): void {
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
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
