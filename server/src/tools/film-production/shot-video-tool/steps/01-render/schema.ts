/**
 * tools/film-production/shot-video-tool/steps/01-render/schema.ts
 */

import { z } from 'zod';

export const ShotVideoStepInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().optional().describe('所属分幕 ID'),
  shotId: z.string().optional().describe('镜头 ID (可选，留空则自动对全剧未生成视频批量生成)'),
  force: z.boolean().default(false).describe('是否强制重绘'),
  customPrompt: z.string().optional().describe('创作者手动调整的视频表演运镜词'),
  referenceImageUrl: z.string().optional().describe('指定作为起始构图参考的辅助图 URL（注入 Ref2V 参考列表）'),
  mode: z.enum(['ref2v']).optional().describe('视频生成模式（固定走 ref2v 全能多图参考直出）'),
  durationSec: z.number().min(2).max(15).optional().describe('指定视频时长（秒，2~15）'),
});

export const ShotVideoStepOutputSchema = z.object({
  projectId: z.string(),
  clipId: z.string().optional(),
  shotId: z.string().optional(),
  videoUrl: z.string().optional(),
  reused: z.boolean().optional(),
  success: z.boolean(),
});

export type ShotVideoStepInput = z.infer<typeof ShotVideoStepInputSchema>;
export type ShotVideoStepOutput = z.infer<typeof ShotVideoStepOutputSchema>;
