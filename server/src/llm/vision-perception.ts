/**
 * llm/vision-perception.ts
 * 全系统通用多模态视觉感知层 (Universal Vision Perception SSOT)
 *
 * 定位：给任意 Agent 装上通用的“眼睛”，服务于全方位视觉理解，包括但不限于：
 * - 画面内容与细节读取（主体、服饰、道具、手部动作、朝向、文字与空间元素）
 * - 美学与风格分析（光影、色调、构图景别、氛围情绪、视觉搭配）
 * - 多图对照与连贯性判断（参考底图 vs 定妆图、首帧 vs 末帧、角色定妆 vs 镜头实帧）
 * - 看图构思与局部修改定位（基于真实画面给出续写构图、运镜衔接或定向修改依据）
 * - 瑕疵与偏差识别
 *
 * 支持双通道自动切换：
 * 1. 原生多模态通道 (LLM_SUPPORTS_VISION=true)：通过 buildMultimodalUserContent 直接随当轮消息传原图；
 * 2. 独立 VLM 视觉代理通道 (纯文本主模型默认)：通过 perceiveVisualContext 携创作者当轮原话多图同看。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ImagePart, TextPart } from 'ai';
import { config } from '../utils/config.js';
import { MediaResolver } from '../media/MediaResolver.js';
import { combineAbortSignals } from '../workflow-engine/run-context.js';

export interface VisionImageRef {
  mediaUrl: string;
  label: string;
  role?: string;
  note?: string;
}

export interface ResolvedVisionImage extends VisionImageRef {
  diskPath: string;
  mimeType: string;
  buffer: Buffer;
  base64Data: string;
  fingerprint: string;
}

export interface PerceiveVisualContextOptions {
  projectId: string;
  images: ResolvedVisionImage[];
  userMessage?: string;
  contextHint?: string;
  abortSignal?: AbortSignal;
}

type VisionPerceiverFn = (args: {
  images: ResolvedVisionImage[];
  userMessage?: string;
  contextHint?: string;
  abortSignal?: AbortSignal;
}) => Promise<string | null>;

const MAX_IMAGES_PER_TURN = 6;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 96;
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const perceptionCache = new Map<string, string>();
let customPerceiverForTest: VisionPerceiverFn | null = null;

function setCacheEntry(key: string, value: string): void {
  if (perceptionCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = perceptionCache.keys().next().value;
    if (oldestKey) perceptionCache.delete(oldestKey);
  }
  perceptionCache.set(key, value);
}

function stripQuery(url: string): string {
  return url.split('?')[0].trim();
}

/**
 * 安全解析并读取项目本地图片（沙箱校验 + 去重 + 数量/大小门禁）
 */
export function resolveVisionImages(
  projectId: string,
  refs: VisionImageRef[]
): ResolvedVisionImage[] {
  if (!Array.isArray(refs) || refs.length === 0) return [];

  const seenPaths = new Set<string>();
  const resolvedList: ResolvedVisionImage[] = [];

  for (const ref of refs) {
    if (resolvedList.length >= MAX_IMAGES_PER_TURN) break;
    if (!ref?.mediaUrl || typeof ref.mediaUrl !== 'string') continue;

    const cleanedUrl = stripQuery(ref.mediaUrl);
    if (!cleanedUrl) continue;

    const resolved = MediaResolver.resolveDiskPath(cleanedUrl, projectId);
    if (!resolved.isValid || !resolved.diskPath) continue;
    if (seenPaths.has(resolved.diskPath)) continue;

    const ext = path.extname(resolved.diskPath).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved.diskPath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) continue;

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(resolved.diskPath);
    } catch {
      continue;
    }

    seenPaths.add(resolved.diskPath);
    resolvedList.push({
      ...ref,
      diskPath: resolved.diskPath,
      mimeType,
      buffer,
      base64Data: buffer.toString('base64'),
      fingerprint: `${resolved.diskPath}:${stat.mtimeMs}:${stat.size}`,
    });
  }

  return resolvedList;
}

/**
 * 原生多模态通道：将当轮文本与已解析图片组装为标准 Vercel AI SDK 多模态消息体
 */
export function buildMultimodalUserContent(
  text: string,
  images: ResolvedVisionImage[]
): Array<TextPart | ImagePart> {
  if (!images.length) return [{ type: 'text', text }];

  const imageLegend = images
    .map((img, idx) => {
      const rolePart = img.role ? `[${img.role}] ` : '';
      const notePart = img.note ? `（${img.note}）` : '';
      return `图${idx + 1}: ${rolePart}${img.label}${notePart}`;
    })
    .join('\n');

  const parts: Array<TextPart | ImagePart> = [
    {
      type: 'text',
      text: `${text}\n\n[随本轮附带的实时画面，请直接结合图像视觉信息回应]\n${imageLegend}`,
    },
  ];

  for (const img of images) {
    parts.push({
      type: 'image',
      image: img.buffer,
      mimeType: img.mimeType,
    });
  }

  return parts;
}

async function callOpenAICompatibleVlm(args: {
  images: ResolvedVisionImage[];
  userMessage?: string;
  contextHint?: string;
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  const { apiKey, baseURL, model, timeoutMs } = config.vlm;
  if (!apiKey || !baseURL || !model || args.images.length === 0) return null;

  const endpoint = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  timer.unref?.();

  const signal = combineAbortSignals(args.abortSignal, timeoutCtrl.signal);
  const imageLegend = args.images
    .map((img, idx) => {
      const rolePart = img.role ? `[${img.role}] ` : '';
      const notePart = img.note ? `（参考背景：${img.note.slice(0, 220)}）` : '';
      return `- 图${idx + 1}：${rolePart}${img.label}${notePart}`;
    })
    .join('\n');

  const promptLines = [
    '你是影视创作团队的通用视觉感知眼睛。请直接、客观、细致地观察下面提供的画面，为上游导演提供全面准确的视觉事实，不要寒暄，不要越权发号施令。',
    args.contextHint ? `当前工作区位置：${args.contextHint}` : '',
    `画面清单（按上传顺序）：\n${imageLegend}`,
    args.userMessage?.trim()
      ? `创作者本轮原话：「${args.userMessage.trim().slice(0, 300)}」`
      : '',
    '请用 150~280 字纯中文输出客观视觉观察：',
    '1. 画面实况与视觉要素：描述可见的主体形象、服饰/道具与手持物、姿态朝向、景别构图、空间环境、光影色彩与整体氛围；',
    args.images.length > 1
      ? '2. 多图关系与对照：客观说明各图之间的视觉一致性、衔接关系、风格呼应或明显差异；'
      : '2. 细节与画面状态：补充构图亮点、可延展的镜头/设计线索，以及肉眼可见的画面瑕疵或偏差（无明显瑕疵则自然带过）；',
    args.userMessage?.trim()
      ? '3. 针对创作者本轮关注点：直接补充创作者提及的任何细节、搭配、位置、修改参考或比对事实。'
      : '',
  ].filter(Boolean);

  const contentParts: Array<Record<string, any>> = [{ type: 'text', text: promptLines.join('\n') }];
  for (const img of args.images) {
    contentParts.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64Data}` },
    });
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 450,
        messages: [{ role: 'user', content: contentParts }],
      }),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[VisionPerception] VLM(${model}) 返回 ${res.status}: ${errBody.slice(0, 200)}`);
      return null;
    }

    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
        .trim();
      return text || null;
    }
    return null;
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn(`[VisionPerception] 视觉感知跳过 (${model}):`, err?.message || String(err));
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 独立 VLM 视觉代理通道：结合创作者当前意图多图同看，返回客观全面的视觉观察摘要。
 */
export async function perceiveVisualContext(
  options: PerceiveVisualContextOptions
): Promise<string | null> {
  const { images, userMessage, contextHint, abortSignal } = options;
  if (!images.length) return null;

  if (!customPerceiverForTest) {
    if (!config.vlm.enabled || config.llm.provider === 'mock' || !config.vlm.apiKey || !config.vlm.model) {
      return null;
    }
  }

  const normalizedQuestion = (userMessage || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const imageKey = images.map((i) => `${i.role || ''}:${i.fingerprint}`).join('|');
  const cacheKey = `${imageKey}::${normalizedQuestion}`;
  const cached = perceptionCache.get(cacheKey);
  if (cached) return cached;

  const runner = customPerceiverForTest || callOpenAICompatibleVlm;
  const observation = await runner({
    images,
    userMessage: normalizedQuestion || undefined,
    contextHint,
    abortSignal,
  });

  if (observation && observation.trim()) {
    const clean = observation.trim();
    setCacheEntry(cacheKey, clean);
    return clean;
  }
  return null;
}

export function _setVisionPerceiverForTest(fn: VisionPerceiverFn | null): void {
  customPerceiverForTest = fn;
  perceptionCache.clear();
}
