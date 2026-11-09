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
    fs.renameSync(tmpPath, targetPath);
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
