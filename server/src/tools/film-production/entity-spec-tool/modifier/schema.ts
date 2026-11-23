/**
 * tools/film-production/entity-spec-tool/modifier/schema.ts
 * 单实体视觉规格微调契约 (Entity Spec Modifier Contract SSOT)
 */

import { z } from 'zod';
import { EntitySpecOutputSchema } from '../steps/01-spec/index.js';

export const EntitySpecModifierInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  targetKind: z.enum(['character', 'location', 'item']).describe('实体类别：character=角色，location=场景，item=道具'),
  targetId: z.string().optional().describe('已有实体的 ID'),
  name: z.string().describe('实体名称'),
  instruction: z.string().optional().describe('创作者个性化修改要求（如：更加年轻俊朗、增加冷冽书生气）'),
  customPrompt: z.string().optional().describe('创作者直接指定的定妆生图词（直接采用，跳过 LLM 生成）'),
  storyMarkdown: z.string().optional().describe('剧本或故事正文 Markdown'),
  prd: z.any().optional().describe('策划案 PRD (UniversalPrdSpec)'),
});

export type EntitySpecModifierInput = z.infer<typeof EntitySpecModifierInputSchema>;

export const EntitySpecModifierOutputSchema = EntitySpecOutputSchema;
export type EntitySpecModifierOutput = z.infer<typeof EntitySpecModifierOutputSchema>;
