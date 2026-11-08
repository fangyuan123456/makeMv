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

/**
 * 单角色定妆条目 —— 只持有「视觉派生结果」，不持有角色客观事实。
 *
 * 明确禁止出现 role / gender / age / appearance / personality / motivation 等字段：
 * 这些事实的唯一来源是故事圣经 (narrative_design.characters)，需要时按 characterId
 * （老数据按 name）现查（见 agents/director/character-facts.ts）。历史上这里整份复制过
 * 一遍角色属性，导致「改了设定下游不跟着变」，且任何修改裁决都无法分辨定义处与派生处。
 */
export const CharacterSheetItemSchema = z.object({
  /**
   * 稳定身份：来自故事圣经的同名角色，写入层自动补齐（见 character-identity.ts）。
   * 与 name 解耦——改名不动它，因此改名不会断开关联；同名角色靠它区分。
   * 老数据可能没有，读取期回落按 name 匹配。
   */
  characterId: z.string().optional(),
  name: z.string().describe('角色姓名（展示名；关联优先走 characterId）'),
  visualPrompt: z.string().describe('纯中文电影级特写定妆生图提示词（由角色事实派生）'),
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
