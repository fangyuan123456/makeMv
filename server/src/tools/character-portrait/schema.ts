/**
 * skills/character-portrait/schema.ts
 * 角色定妆视觉规范 Zod 契约规约 (Character Portrait Zod SSOT)
 */

import { z } from 'zod';

// 1. 微调角色生图提示词输出 Schema
export const RefineCharacterVisualPromptSchema = z.object({
  refinedVisualPrompt: z.string().describe('融合重写后的纯中文电影级定妆生图提示词'),
  designNotes: z.string().optional().describe('设计调优思路与美学考量说明'),
});

export type RefineCharacterVisualPromptOutput = z.infer<typeof RefineCharacterVisualPromptSchema>;

// 2. 批量推演角色视觉规范条目 Schema
export const CharacterVisualSpecItemSchema = z.object({
  name: z.string().describe('角色姓名'),
  visualPrompt: z.string().describe('纯中文电影级特写定妆生图提示词'),
});

export const CharacterVisualSpecsListSchema = z.object({
  specs: z.array(CharacterVisualSpecItemSchema).describe('角色视觉提示词规范清单'),
});

export type CharacterVisualSpecsListOutput = z.infer<typeof CharacterVisualSpecsListSchema>;

// 3. 完整角色资产档案条目
export const CharacterSheetItemSchema = z.object({
  name: z.string(),
  role: z.string(),
  gender: z.string().optional(),
  age: z.union([z.number(), z.string()]).optional(),
  appearance: z.string(),
  personality: z.string().optional(),
  motivation: z.string().optional(),
  visualPrompt: z.string(),
  imageUrl: z.string().optional(),
  referenceImageUrl: z.string().optional(),
  selected: z.boolean().optional(),
  isDegraded: z.boolean().optional(),
  degradedReason: z.string().optional(),
});

export type CharacterSheetItem = z.infer<typeof CharacterSheetItemSchema>;

// 4. 角色定妆工序最终落盘产物
export const CharacterPortraitArtifactSchema = z.object({
  characters: z.array(CharacterSheetItemSchema),
  totalCharacters: z.number(),
  completedCharacters: z.number(),
  style: z.string(),
  isRefinement: z.boolean().optional(),
  targetCharacterNames: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type CharacterPortraitArtifact = z.infer<typeof CharacterPortraitArtifactSchema>;
