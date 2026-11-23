/**
 * tools/film-production/entity-spec-tool/character/schema.ts
 * 角色视觉规格契约 (Character Spec Contract SSOT)
 */

import { z } from 'zod';
import { CharacterSpecSchema } from '../../../../project-store/contracts/film-production/lookdev.js';

export { CharacterSpecSchema };
export type CharacterSpec = z.infer<typeof CharacterSpecSchema>;

export const CharacterSpecInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  characterId: z.string().optional().describe('角色唯一标识'),
  name: z.string().describe('角色姓名'),
  roleOrBrief: z.string().optional().describe('身份定位或一句话概述'),
  instruction: z.string().optional().describe('创作者个性化修改要求'),
  storyMarkdown: z.string().optional().describe('剧本正文'),
  prd: z.any().optional().describe('策划案 PRD'),
});

export type CharacterSpecInput = z.infer<typeof CharacterSpecInputSchema>;
