/**
 * tools/film-production/entity-spec-tool/item/schema.ts
 * 道具视觉规格契约 (Item Spec Contract SSOT)
 */

import { z } from 'zod';
import { ItemSpecSchema } from '../../../../project-store/contracts/film-production/lookdev.js';

export { ItemSpecSchema };
export type ItemSpec = z.infer<typeof ItemSpecSchema>;

export const ItemSpecInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  itemId: z.string().optional().describe('道具唯一标识'),
  name: z.string().describe('道具名称'),
  roleOrBrief: z.string().optional().describe('类别或一句话概述'),
  instruction: z.string().optional().describe('创作者个性化修改要求'),
  storyMarkdown: z.string().optional().describe('剧本正文'),
  prd: z.any().optional().describe('策划案 PRD'),
});

export type ItemSpecInput = z.infer<typeof ItemSpecInputSchema>;
