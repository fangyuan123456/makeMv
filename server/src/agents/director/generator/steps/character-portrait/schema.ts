/**
 * agents/pipeline/workflows/steps/character-portrait/schema.ts
 * 角色定妆视觉规范 Zod 契约规约 (Character Portrait Zod SSOT)
 */

import { z } from 'zod';

export const CharacterVisualSpecItemSchema = z.object({
  name: z.string().describe('角色姓名'),
  visualPrompt: z.string().describe('纯中文电影级特写定妆生图提示词'),
});

export const CharacterVisualSpecsListSchema = z.object({
  specs: z.array(CharacterVisualSpecItemSchema).describe('角色视觉提示词规范清单'),
});

export type CharacterVisualSpecsListOutput = z.infer<typeof CharacterVisualSpecsListSchema>;

export const PortraitHistoryRecordSchema = z.object({
  id: z.string().describe('版本标识 ID'),
  imageUrl: z.string().describe('该版本的定妆图 URL'),
  visualPrompt: z.string().describe('生成该版本时使用的生图提示词'),
  createdAt: z.string().describe('记录时间 ISO 字符串'),
});

export type PortraitHistoryRecord = z.infer<typeof PortraitHistoryRecordSchema>;

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
  referenceImageUrl: z.string().optional().describe('当前参考底图 URL（修改逻辑下使用）'),
  useReference: z.boolean().optional().default(true).describe('是否勾选参考底图走修改逻辑 (false为走纯文本全新生成)'),
  isNew: z.boolean().optional().describe('是否为首次全新生成的角色 (尚未定过妆)'),
  history: z.array(PortraitHistoryRecordSchema).optional().default([]).describe('历史定妆版本库'),
  selected: z.boolean().optional(),
  isDegraded: z.boolean().optional(),
  degradedReason: z.string().optional(),
});

export type CharacterSheetItem = z.infer<typeof CharacterSheetItemSchema>;

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
