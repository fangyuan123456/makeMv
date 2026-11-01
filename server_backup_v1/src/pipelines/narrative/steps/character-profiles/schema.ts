/**
 * pipelines/narrative/steps/character-profiles/schema.ts
 * 角色小传与视觉概念卡数据契约与校验 Schema (Zod SSOT)
 */

import { z } from 'zod';

export const CharacterProfileSchema = z.object({
  name: z.string().describe('角色姓名'),
  role: z.string().describe('剧情身份定位 (如 主角/反派/盟友/神秘线人)'),
  gender: z.string().optional().describe('性别'),
  age: z.union([z.string(), z.number()]).optional().describe('年龄'),
  appearance: z.string().describe('详细外貌特写 (体型、面部特征、发型、代表性服饰与色调)'),
  personality: z.string().describe('性格特征与心理防线'),
  motivation: z.string().describe('核心欲望、恐惧或执念动机'),
  arc: z.string().optional().describe('人物成长或蜕变弧光'),
  visualPromptKeywords: z.array(z.string()).optional().default([]).describe('生图定妆提示词关键词清单'),
});

export const CharacterProfilesOutputSchema = z.object({
  characters: z.array(CharacterProfileSchema).min(1).describe('核心登场人物小传数组'),
});

export type CharacterProfilesOutput = z.infer<typeof CharacterProfilesOutputSchema>;
