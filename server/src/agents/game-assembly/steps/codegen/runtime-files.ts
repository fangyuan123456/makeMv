/**
 * agents/game-assembly/steps/codegen/runtime-files.ts
 * 播放底座（系统固定提供，AI 编码阶段只调用、不实现）
 *
 * 底座只有两个文件：runtime/player.js（播放器）与 runtime/player.css（舞台样式）。
 * 源码就是同目录下 runtime/ 里的真实文件，这里只负责读出来落盘，不在这里夹代码。
 */

import { readFileSync } from 'node:fs';

const RUNTIME_DIR = new URL('./runtime/', import.meta.url);

function readRuntime(name: string): string {
  return readFileSync(new URL(name, RUNTIME_DIR), 'utf-8');
}

/** 写给模型看的底座接口说明（游戏代码只能用到这些） */
export const RUNTIME_API_DOC = `【播放视频（已提供底座，禁止另写一套播放器）】
import { play } from '../runtime/player.js';

play(container, url, onEnded)
  container  父容器节点，视频在里面播
  url        这一幕的视频地址
  onEnded    播完回调

URL 指向的是现在这种图文一幕（假视频）还是真视频，由底座分辨；你的代码只当它在播视频。`;

export interface RuntimeFile {
  /** 相对 game-assembly/ 的路径 */
  path: string;
  content: string;
}

/** 编码前由系统落盘，AI 只在规划里引用、在代码里 import */
export const RUNTIME_FILES: RuntimeFile[] = [
  { path: 'runtime/player.js', content: readRuntime('player.js') },
  { path: 'runtime/player.css', content: readRuntime('player.css') },
];
