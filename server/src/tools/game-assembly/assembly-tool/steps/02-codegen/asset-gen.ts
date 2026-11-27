/**
 * tools/game-assembly/assembly-tool/steps/02-codegen/asset-gen.ts
 * 对齐 gamepilot 的游戏 UI / 透明 PNG 素材生成与边缘众数 Chroma-Key 抠图管线
 */

import fs from 'node:fs';
import path from 'node:path';
import { Jimp } from 'jimp';
import { MediaProviderFactory } from '../../../../../media/providers/MediaProviderFactory.js';

export type GameAssetRole = 'icon' | 'sprite' | 'background';
export type GameAssetAspect = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

const ASPECT_TO_SIZE: Record<GameAssetAspect, string> = {
  '1:1': '1024*1024',
  '16:9': '1280*720',
  '9:16': '720*1280',
  '4:3': '1024*768',
  '3:4': '768*1024',
};

const CHROMA_TOLERANCE = 42;
const FEATHER_TOLERANCE = 60;

export function compileGameAssetPrompt(input: {
  prompt: string;
  role: GameAssetRole;
  style?: string;
}): { positive: string; negative: string; transparent: boolean } {
  const styleMod = input.style ? `, ${input.style}` : '';
  if (input.role === 'background') {
    return {
      positive: `${input.prompt}${styleMod}, cinematic game UI background artwork, clean composition, no text, no watermark`,
      negative: 'low quality, blurry, watermark, text, letters, signature, distorted',
      transparent: false,
    };
  }

  return {
    positive: `${input.prompt}${styleMod}, isolated single game ${input.role} centered with generous uniform margin, solid flat #FF00FF magenta background, plain uniform backdrop, no cast shadow, no scenery, crisp silhouette`,
    negative:
      'low quality, blurry, watermark, text, letters, complex background, scenery, ground shadow, gradient background, cropped edge',
    transparent: true,
  };
}

async function fetchImageBuffer(rawUrl: string): Promise<Buffer> {
  if (rawUrl.startsWith('data:')) {
    const base64 = rawUrl.replace(/^data:[^;]+;base64,/, '');
    return Buffer.from(base64, 'base64');
  }
  const res = await fetch(rawUrl);
  if (!res.ok) {
    throw new Error(`下载生成图片失败: HTTP ${res.status}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

function sampleBorderDominantColor(
  data: Uint8Array,
  w: number,
  h: number
): { r: number; g: number; b: number } {
  const border: Array<{ r: number; g: number; b: number }> = [];
  const pushPx = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    border.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  };
  for (let x = 0; x < w; x++) {
    pushPx(x, 0);
    pushPx(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    pushPx(0, y);
    pushPx(w - 1, y);
  }

  const clusters: Array<{ r: number; g: number; b: number; count: number }> = [];
  for (const p of border) {
    let hit = false;
    for (const c of clusters) {
      if (
        Math.max(Math.abs(p.r - c.r), Math.abs(p.g - c.g), Math.abs(p.b - c.b)) <=
        CHROMA_TOLERANCE
      ) {
        c.count += 1;
        hit = true;
        break;
      }
    }
    if (!hit) clusters.push({ r: p.r, g: p.g, b: p.b, count: 1 });
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters[0] || { r: 255, g: 0, b: 255 };
}

function colorDist(
  r: number,
  g: number,
  b: number,
  bg: { r: number; g: number; b: number }
): number {
  return Math.max(Math.abs(r - bg.r), Math.abs(g - bg.g), Math.abs(b - bg.b));
}

export async function processTransparentPng(rawBuffer: Buffer, maxEdge = 512): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  const image = await Jimp.read(rawBuffer);
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;
  const bg = sampleBorderDominantColor(data, w, h);

  // 从四条外边缘进行 Flood-Fill 连通背景抠图，避免误伤主体内部
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const trySeed = (x: number, y: number) => {
    const idx = y * w + x;
    if (visited[idx]) return;
    const p = idx * 4;
    if (colorDist(data[p], data[p + 1], data[p + 2], bg) <= FEATHER_TOLERANCE) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < w; x++) {
    trySeed(x, 0);
    trySeed(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    trySeed(0, y);
    trySeed(w - 1, y);
  }

  while (head < tail) {
    const idx = queue[head++];
    const p = idx * 4;
    const dist = colorDist(data[p], data[p + 1], data[p + 2], bg);

    if (dist <= CHROMA_TOLERANCE) {
      data[p + 3] = 0;
    } else {
      const ratio = (dist - CHROMA_TOLERANCE) / (FEATHER_TOLERANCE - CHROMA_TOLERANCE);
      data[p + 3] = Math.round(data[p + 3] * Math.min(1, Math.max(0, ratio)));
    }

    if (dist <= CHROMA_TOLERANCE + 8) {
      const x = idx % w;
      const y = (idx - x) / w;
      if (x > 0) trySeed(x - 1, y);
      if (x + 1 < w) trySeed(x + 1, y);
      if (y > 0) trySeed(x, y - 1);
      if (y + 1 < h) trySeed(x, y + 1);
    }
  }

  // 清理封闭镂空区域（如提环、把手内侧）残留的高饱和品红抠像色
  for (let i = 0; i < w * h * 4; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r >= 165 && b >= 120 && g <= 110 && Math.min(r, b) - g >= 55) {
      data[i + 3] = 0;
    }
  }

  // 计算非透明像素包围盒并紧致裁切（保留 4% 安全边距）
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX >= minX && maxY >= minY) {
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const pad = Math.round(Math.max(bw, bh) * 0.04);
    const cx = Math.max(0, minX - pad);
    const cy = Math.max(0, minY - pad);
    const cw = Math.min(w - cx, bw + pad * 2);
    const ch = Math.min(h - cy, bh + pad * 2);
    image.crop({ x: cx, y: cy, w: cw, h: ch });
  }

  if (maxEdge > 0 && (image.bitmap.width > maxEdge || image.bitmap.height > maxEdge)) {
    image.scaleToFit({ w: maxEdge, h: maxEdge });
  }

  const outBuf = await image.getBuffer('image/png');
  return {
    buffer: outBuf,
    width: image.bitmap.width,
    height: image.bitmap.height,
  };
}

export async function generateGameUiAsset(input: {
  gameAssemblyDir: string;
  targetPath: string;
  prompt: string;
  role?: GameAssetRole;
  aspect?: GameAssetAspect;
  style?: string;
}): Promise<{
  ok: boolean;
  path: string;
  diskPath: string;
  width: number;
  height: number;
  transparent: boolean;
  provider: string;
}> {
  const role: GameAssetRole = input.role || 'icon';
  const aspect: GameAssetAspect = input.aspect || (role === 'background' ? '16:9' : '1:1');
  const relClean = input.targetPath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  const relWithPng = relClean.endsWith('.png') ? relClean : `${relClean.replace(/\.[^.]+$/, '')}.png`;
  const diskPath = path.resolve(input.gameAssemblyDir, relWithPng);
  const rootResolved = path.resolve(input.gameAssemblyDir);

  if (!diskPath.startsWith(rootResolved + path.sep)) {
    throw new Error(`非法素材路径（越界）: ${input.targetPath}`);
  }

  const compiled = compileGameAssetPrompt({
    prompt: input.prompt,
    role,
    style: input.style,
  });

  const provider = MediaProviderFactory.getImageProvider();
  const rawUrl = await provider.generateImage(compiled.positive, {
    size: ASPECT_TO_SIZE[aspect],
    negativePrompt: compiled.negative,
    mode: 'general_t2i',
  });

  const rawBuffer = await fetchImageBuffer(rawUrl);
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });

  if (compiled.transparent) {
    // 若 Mock 返回 SVG，直接存 svg 也兼容；真实位图走 Jimp 抠图转透明 PNG
    if (rawUrl.startsWith('data:image/svg+xml')) {
      fs.writeFileSync(diskPath, rawBuffer);
      return {
        ok: true,
        path: relWithPng,
        diskPath,
        width: 512,
        height: 512,
        transparent: true,
        provider: provider.name,
      };
    }
    const processed = await processTransparentPng(rawBuffer, role === 'icon' ? 512 : 768);
    fs.writeFileSync(diskPath, processed.buffer);
    return {
      ok: true,
      path: relWithPng,
      diskPath,
      width: processed.width,
      height: processed.height,
      transparent: true,
      provider: provider.name,
    };
  }

  const bgImage = await Jimp.read(rawBuffer);
  const bgBuf = await bgImage.getBuffer('image/png');
  fs.writeFileSync(diskPath, bgBuf);
  return {
    ok: true,
    path: relWithPng,
    diskPath,
    width: bgImage.bitmap.width,
    height: bgImage.bitmap.height,
    transparent: false,
    provider: provider.name,
  };
}
