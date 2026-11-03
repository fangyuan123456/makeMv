/**
 * skills/storyboard/schema.ts
 * 导演视听分镜 Zod 契约规约 (Storyboard Zod SSOT)
 */

import { z } from 'zod';

// 1. 单个视听分镜镜头条目 Schema
export const StoryboardShotItemSchema = z.object({
  shotId: z.string().describe('镜头标识，如 shot_1'),
  nodeId: z.string().describe('所属网状剧情节点 ID (如 node_1, node_2)'),
  shotNumber: z.number().describe('镜头全局序号'),
  shotScale: z.enum(['特写', '近景', '中景', '全景', '大远景']).or(z.string()).describe('摄影机景别'),
  cameraMovement: z.string().describe('摄影机运镜动感方式（如 推、拉、摇、移、跟、固定）'),
  durationSec: z.number().min(1).max(30).describe('建议镜头持续秒数 (3~6s)'),
  visualComposition: z.string().describe('视听画面构图与光影透视描述'),
  audioPrompt: z.string().optional().describe('同期声音效与配乐情绪氛围提示'),
});

export type StoryboardShotItem = z.infer<typeof StoryboardShotItemSchema>;

// 2. 分镜头切分批次输出 Schema (面向大模型 generateObject 输出契约)
export const StoryboardBatchOutputSchema = z.object({
  shots: z.array(StoryboardShotItemSchema).describe('视听分镜头清单'),
});

export type StoryboardBatchOutput = z.infer<typeof StoryboardBatchOutputSchema>;

// 3. 完整分镜头工序落盘产物 Schema
export const StoryboardArtifactSchema = z.object({
  title: z.string(),
  shots: z.array(StoryboardShotItemSchema),
  totalShots: z.number(),
  estimatedTotalDurationSec: z.number(),
  createdAt: z.string(),
});

export type StoryboardArtifact = z.infer<typeof StoryboardArtifactSchema>;
