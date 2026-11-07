/**
 * modifier/steps/image/character-portrait/schema.ts
 * 角色定妆「精修」输出契约 (Modifier Schema SSOT)
 *
 * 只服务修改轨：生成轨从不使用这份契约，因此不放在 artifacts/ 也不放在生成轨 schema。
 */

import { z } from 'zod';

/** 精修输出的 LLM 结构化契约（只服务修改轨） */
export const RefineCharacterVisualPromptSchema = z.object({
  refinedVisualPrompt: z.string().describe('融合重写后的纯中文电影级定妆生图提示词'),
  designNotes: z.string().optional().describe('设计调优思路与美学考量说明'),
});

export type RefineCharacterVisualPromptOutput = z.infer<typeof RefineCharacterVisualPromptSchema>;
