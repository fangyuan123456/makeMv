/**
 * chat/memory/schema.ts
 * 全局备忘录提炼 Zod 契约规约 (Scratchpad Zod SSOT)
 */

import { z } from 'zod';

export const ScratchpadSummarySchema = z.object({
  themeAndStyle: z.string().optional().describe('提炼后的影调风格描述'),
  logline: z.string().optional().describe('提炼后的一句话大纲 (若无讨论则沿用原大纲)'),
  charactersSummary: z.string().optional().describe('提炼后的主要角色特征清单 (姓名、性格、职业、反差)'),
  characterVisualAnchors: z.string().optional().describe('提炼后的核心角色视觉定妆锚点 (发型、服装色彩、标志性配饰)'),
  storySpine: z.string().optional().describe('提炼后的黄金核心冲突 (两难困境、主线目标)'),
  userConstraints: z.array(z.string()).optional().describe('整合提纯后的全量精炼禁忌与偏好列表'),
  cinematographyAndRhythm: z.string().optional().describe('提炼后的镜头运镜基调、镜头时长与剪辑节奏规范'),
  audioAndVoicePreferences: z.string().optional().describe('提炼后的角色音色偏好、BGM影调与声音对白质感'),
  packagingAndInteractiveSpec: z.string().optional().describe('提炼后的互动决策机制、分支收束与UI包装技术规范'),
});

export type ScratchpadSummaryOutput = z.infer<typeof ScratchpadSummarySchema>;
