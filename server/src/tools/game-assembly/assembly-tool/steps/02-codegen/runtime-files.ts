/**
 * tools/game-assembly/steps/02-codegen/runtime-files.ts
 * 播放底座文件静态落盘提供者 (SSOT)
 */

import { readFileSync } from 'node:fs';

const RUNTIME_DIR = new URL('./runtime/', import.meta.url);

function readRuntime(name: string): string {
  return readFileSync(new URL(name, RUNTIME_DIR), 'utf-8');
}

export interface RuntimeFile {
  /** 相对 game-assembly/ 的路径 */
  path: string;
  content: string;
}

/** 编码前由系统落盘，AI 只在规划里引用、在代码里 import */
export const RUNTIME_FILES: RuntimeFile[] = [
  { path: 'runtime/player.js', content: readRuntime('player.js') },
  { path: 'runtime/player.css', content: readRuntime('player.css') },
  { path: 'runtime/engine.js', content: readRuntime('engine.js') },
];
