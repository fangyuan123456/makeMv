/**
 * agents/runtime/viewport-observer.ts
 * 创作者实时视口焦点与多模态视觉感知深模块 (Deep Module)
 *
 * 核心架构职责：
 * 1. 统一渲染创作者实时视口焦点与意图范围仲裁法典（三级判定 SSOT）；
 * 2. 结合独立 VLM 视觉观察器对创作者发送图片及当前视口画面执行感知并注入上下文。
 */

import { config } from '../../utils/config.js';
import {
  perceiveVisualContext,
  type ResolvedVisionImage,
} from '../../llm/vision-perception.js';
import type { AgentFocusContext } from './types.js';

export interface RenderViewportOptions {
  projectId: string;
  focus?: AgentFocusContext;
  userMessage?: string;
  attachments?: Array<{ url: string; name?: string }>;
  images?: ResolvedVisionImage[];
  extraDetails?: string[];
  abortSignal?: AbortSignal;
}

/**
 * 全系统统一视口焦点与视觉上下文渲染器（SSOT）：偏重当前聚焦对象与用户发图分析，绝不限制全局讨论范围。
 */
export async function renderViewportContextSection(options: RenderViewportOptions): Promise<string> {
  const { projectId, focus, userMessage, attachments = [], images: resolvedImages = [], extraDetails = [], abortSignal } = options;
  const hasLocation = Boolean(focus?.location?.trim());

  if (!hasLocation && attachments.length === 0 && resolvedImages.length === 0) return '';

  const lines: string[] = [];

  if (hasLocation && focus) {
    const targetDesc = focus.target
      ? `（当前聚焦: ${focus.target.label || focus.target.id}${focus.target.subview ? ` · ${focus.target.subview}` : ''} [${focus.target.kind}:${focus.target.id}]）`
      : '';
    lines.push(`- 创作者实时视口：${focus.location.trim()}${targetDesc}`);

    for (const line of extraDetails) {
      const trimmed = String(line || '').trim();
      if (!trimmed) continue;
      lines.push(trimmed.startsWith('- ') ? trimmed : `- ${trimmed}`);
    }
  }

  if (attachments.length > 0) {
    const attDesc = attachments
      .map((att, idx) => `附件${idx + 1}(${att.name || '图片'}, url: ${att.url})`)
      .join('、');
    lines.push(
      `- 创作者本轮发送图片：${attDesc}（可作为参考底图直接引用）`
    );
  }

  // 通用多模态眼睛：纯文本主模型时由独立 VLM 结合创作者本轮原话执行多图全面观察并注入当轮记忆
  if (resolvedImages.length > 0 && !config.llm.supportsVision) {
    const visualObservation = await perceiveVisualContext({
      projectId,
      images: resolvedImages,
      userMessage,
      contextHint: focus?.location,
      abortSignal,
    });
    if (visualObservation) {
      const titles = resolvedImages
        .map((img, i) => `图${i + 1}${img.role ? `[${img.role}]` : ''}:${img.label}`)
        .join('、');
      lines.push(`- 实时画面观察（${titles}）：\n${visualObservation}`);
    }
  }

  return lines.join('\n');
}
