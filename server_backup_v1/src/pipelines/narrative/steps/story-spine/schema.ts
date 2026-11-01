/**
 * pipelines/narrative/steps/story-spine/schema.ts
 * 黄金戏剧主干大纲数据契约与校验 Schema (Zod SSOT)
 */

import { z } from 'zod';

export const GoldenSpineActSchema = z.object({
  act: z.number().describe('幕次序号'),
  name: z.string().describe('幕次名称'),
  summary: z.string().describe('剧情概要'),
  targetDurationSec: z.number().optional().default(60).describe('建议时长秒数'),
  cliffhanger: z.string().optional().describe('本幕结尾悬念钩子'),
});

export const StorySpineSchema = z.object({
  title: z.string().describe('互动影游商业化项目主标题'),
  theme: z.string().describe('核心哲学/戏剧冲突主题'),
  style: z.string().describe('视觉与影调风格说明'),
  logline: z.string().describe('一句话核心故事大纲 (Logline)'),
  sellingPoints: z.array(z.string()).min(1).describe('核心看点与商业卖点清单'),
  goldenSpine: z.array(GoldenSpineActSchema).min(3).describe('三幕或多幕黄金戏剧骨架'),
});

export type StorySpineData = z.infer<typeof StorySpineSchema>;
