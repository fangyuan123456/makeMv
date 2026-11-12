/**
 * agents/film-adapter/schema.ts
 * 影视视听切片资产订单强类型 Zod 契约 (Film Asset Order Schema SSOT)
 *
 * 核心设计：
 * 1. 与文游节点一对一锚定；
 * 2. 包含可直接喂给物理工具 (SD/Runway/ComfyUI/TTS) 的精确参数；
 * 3. 包含时间轴交互激活窗口与无缝剪辑接点 (Match Cut)。
 */

import { z } from 'zod';

export const CinematicClipOrderSchema = z.object({
  clipId: z.string().describe('切片唯一标识，与剧本/文游节点 1:1 锚定，如 S1, S1.1'),
  sourceNodeId: z.string().describe('对应的文游节点 ID'),
  targetDurationSec: z.number().default(5.0).describe('视频生成预估目标时长（秒）'),
  shotType: z.string().describe('景别与机位，如 CLOSE_UP / MEDIUM_SHOT / OVER_THE_SHOULDER / WIDE_SHOT'),
  visualPrompt: z
    .string()
    .describe('纯英文高精度文生图/图生视频 Prompt（须严格贴合原作题材美术风格、时代背景、光影色调与角色神态服化道，禁止套用无关题材滤镜）'),
  audioDialogue: z.string().default('').describe('角色对白文本（供 TTS 语音合成）'),
  audioAmbience: z.string().default('').describe('贴合当下情境的背景音效与环境氛围音'),
  matchCutAnchor: z
    .string()
    .describe('无缝动势接点要点：描述镜头切换时的动作顺向动量与视线轴线，确保不黑屏穿帮'),
});

export const FilmAdapterArtifactSchema = z.object({
  schemaVersion: z.string().default('1.0.0'),
  projectTitle: z.string().describe('作品名称'),
  clips: z.array(CinematicClipOrderSchema).min(1).describe('全量待渲染视听切片需求清单'),
});

export type CinematicClipOrder = z.infer<typeof CinematicClipOrderSchema>;
export type FilmAdapterArtifact = z.infer<typeof FilmAdapterArtifactSchema>;
