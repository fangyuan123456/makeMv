/**
 * pipelines/character/steps/visual-spec/schema.ts
 * 角色定妆视觉规范数据契约与校验 Schema (Zod SSOT)
 */

import { z } from 'zod';

export const VisualSpecSchema = z.object({
  name: z.string().describe('角色姓名'),
  role: z.string().describe('剧情身份'),
  positivePrompt: z.string().describe('专业英文生图正向提示词 (Midjourney/Flux/SD 语法，包含相机质感与打光)'),
  negativePrompt: z.string().optional().default('low quality, blurry, deformed limbs, bad anatomy, anime, cartoon, sketch').describe('生图负向提示词'),
  lighting: z.string().describe('影视布光方案 (如 伦勃朗光、侧逆光冷暖对冲)'),
  shotType: z.string().describe('标准拍摄景别 (如 电影中景肖像、特写)'),
  aspectRatio: z.string().optional().default('16:9').describe('画面比例'),
  clothingDetails: z.string().describe('标志性服装面料、质感与配色细则'),
  facialFeatures: z.string().describe('面部骨相特写、肤质细节与辨识特征'),
});

export const VisualSpecBatchSchema = z.object({
  specs: z.array(VisualSpecSchema).min(1).describe('全剧各角色视觉定妆规范清单'),
});

export type VisualSpecData = z.infer<typeof VisualSpecSchema>;
export type VisualSpecBatchData = z.infer<typeof VisualSpecBatchSchema>;
