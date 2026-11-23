/**
 * utils/atomicFile.ts
 * 系统级原子文件安全写入工具 (Atomic File System SSOT)
 *
 * 核心原理：先写入同目录下的 .tmp 文件，完成后通过原子重命名 (renameSync) 替换目标文件。
 * 彻底避免并发读写半截文件、断电或进程中断导致数据物理损坏。
 */

import fs from 'fs';
import path from 'path';

/**
 * 原子化写入 UTF-8 字符串到指定文件
 */
export function atomicWriteStringSync(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');

    // Windows 平台下目标文件可能被防病毒扫描或瞬间读取句柄占用，加入重试与 copy 兜底机制
    let replaced = false;
    let lastError: any = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.renameSync(tmpPath, targetPath);
        replaced = true;
        break;
      } catch (err: any) {
        lastError = err;
        if (err?.code === 'EPERM' || err?.code === 'EBUSY') {
          // 尝试降级使用 copyFileSync + unlinkSync
          try {
            fs.copyFileSync(tmpPath, targetPath);
            fs.unlinkSync(tmpPath);
            replaced = true;
            break;
          } catch {}
          // 短暂同步微休眠退避 (20ms ~ 50ms)
          const waitEnd = Date.now() + 25 * (attempt + 1);
          while (Date.now() < waitEnd) {}
        } else {
          throw err;
        }
      }
    }

    if (!replaced && lastError) {
      throw lastError;
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

/**
 * 原子化格式化写入 JSON 对象到指定文件
 */
export function atomicWriteJsonSync(targetPath: string, data: any, spaces: number = 2): void {
  const serialized = JSON.stringify(data, null, spaces);
  atomicWriteStringSync(targetPath, serialized);
}

/**
 * 安全读取 JSON 文件（若不存在则返回 null）
 */
export function safeReadJsonSync<T = any>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
