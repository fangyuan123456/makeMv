/**
 * tools/planner/screenplay-tool/steps/01-premise/schema.ts
 * 步骤一：设定与故事大纲专属契约 (Premise Step Contract)
 */

import { z } from 'zod';

export const ScreenplayInputSchema = z.object({
  userPrompt: z.string().describe('创作者输入的创意灵感、故事设定或剧本构想'),
  genre: z.string().optional().describe('故事题材类型 (如科幻、悬疑探案、中式微恐、权谋古风等)'),
  tone: z.string().optional().describe('视听基调偏好 (如暗黑压抑、快节奏硬核、冷峻电影质感等)'),
  expectedActs: z.number().int().min(2).max(6).default(3).describe('期望故事分幕数量 (默认 3 幕)'),
});

export type ScreenplayInput = z.infer<typeof ScreenplayInputSchema>;

export const ScreenplayCharacterSchema = z.object({
  name: z.string().describe('角色姓名'),
  role: z.string().describe('角色身份/定位 (如主角、神秘线人、反派幕后黑手)'),
  motivation: z.string().describe('核心心理动机与戏剧目标'),
  appearance: z.string().describe('外貌衣着特征与标志性视听符号'),
});

export type ScreenplayCharacter = z.infer<typeof ScreenplayCharacterSchema>;

export const PremiseOutputSchema = z.object({
  title: z.string().describe('互动影游中文标题'),
  genre: z.string().describe('题材分类'),
  logline: z.string().describe('一句话核心故事梗概'),
  characters: z.array(ScreenplayCharacterSchema).describe('核心角色设定列表'),
  actOutlines: z.array(
    z.object({
      actNumber: z.number().describe('幕次序号'),
      title: z.string().describe('本幕标题'),
      coreConflict: z.string().describe('核心戏剧冲突'),
      suspense: z.string().describe('引发互动的悬念核心'),
    })
  ).describe('各幕大纲概要'),
});

export type PremiseOutput = z.infer<typeof PremiseOutputSchema>;

export const PremiseStepInputSchema = ScreenplayInputSchema.extend({
  _context: z.any().optional(),
});

export type PremiseStepInput = z.infer<typeof PremiseStepInputSchema>;
