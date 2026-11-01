/**
 * pipelines/narrative/steps/pivot-points/schema.ts
 * 互动抉择矩阵数据契约与校验 Schema (Zod SSOT)
 */

import { z } from 'zod';

export const MacroChoiceSchema = z.object({
  choiceId: z.string().describe('选项唯一标识，如 choice_1'),
  text: z.string().describe('抉择选项文本'),
  dramaticImpact: z.string().describe('该选择引发的戏剧走向与后果'),
  targetAct: z.number().optional().describe('预期导向的幕次序号'),
});

export const MacroPivotPointSchema = z.object({
  id: z.string().describe('抉择点 ID，如 pivot_1'),
  act: z.number().describe('所属幕次'),
  decisionMoment: z.string().describe('核心危机抉择时刻情境描述'),
  choices: z.array(MacroChoiceSchema).min(2).describe('至少两个互斥且动机强烈的选项'),
});

export const MicroPivotPointSchema = z.object({
  id: z.string().describe('微观交互 ID'),
  sceneName: z.string().describe('发生场景'),
  interactiveMechanic: z.string().describe('交互操作机制 (如 QTE、线索调查、眼神比对)'),
  feedback: z.string().describe('玩家操作成败带来的微观视听反馈'),
});

export const PivotPointsSchema = z.object({
  macroPivotPoints: z.array(MacroPivotPointSchema).min(1).describe('宏观剧情分支抉择点'),
  microPivotPoints: z.array(MicroPivotPointSchema).optional().default([]).describe('场景微观即时交互点'),
});

export type PivotPointsOutput = z.infer<typeof PivotPointsSchema>;
