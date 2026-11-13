/**
 * scripts/copy-runtime-assets.mjs
 * tsc 只编译 .ts，不会带走 codegen/runtime/ 下的真实 .js/.css/.md 底座文件，
 * 所以 build 之后补一次拷贝，让 dist 里的 runtime-files.js 仍能按相对路径读到它们。
 */

import { cpSync, existsSync } from 'node:fs';

const from = new URL('../src/agents/text-game/steps/codegen/runtime/', import.meta.url);
const to = new URL('../dist/agents/text-game/steps/codegen/runtime/', import.meta.url);

if (!existsSync(new URL('../dist/', import.meta.url))) {
  console.error('[copy-runtime-assets] 没有 dist 目录，先跑 tsc');
  process.exit(1);
}

cpSync(from, to, { recursive: true });
console.log('[copy-runtime-assets] 播放底座已复制到 dist');
