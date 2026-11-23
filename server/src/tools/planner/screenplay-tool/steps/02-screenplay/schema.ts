/**
 * tools/planner/screenplay-tool/steps/02-screenplay/schema.ts
 * 步骤二：全景剧本创作专属契约 (Screenplay Step Contract)
 */

import { z } from 'zod';
import {
  PremiseOutputSchema,
  ScreenplayCharacterSchema,
  type PremiseOutput,
  type ScreenplayCharacter,
} from '../01-premise/schema.js';

export const ScreenplayOutputSchema = z.object({
  title: z.string().describe('互动影游中文标题'),
  genre: z.string().describe('确立的题材类型'),
  logline: z.string().describe('一句话核心故事梗概 (Logline)'),
  characters: z.array(ScreenplayCharacterSchema).describe('登场的核心角色设定清单'),
  scriptMarkdown: z.string().describe('完整的 Markdown 格式互动影游全景剧本 (含分幕、台词、抉择选项与分支终局)'),
});

export type ScreenplayOutput = z.infer<typeof ScreenplayOutputSchema>;

export const FullScriptTextOutputSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().describe('严格对应大纲节点 ID'),
    narrativeText: z.string().min(1).describe('本节点可拍摄的场景、行动与对白；不含选项、连接或终局标记'),
  })).min(1),
});

export type FullScriptTextOutput = z.infer<typeof FullScriptTextOutputSchema>;

export const NodeScriptOutputSchema = z.object({
  narrativeText: z.string().min(1).describe('当前唯一路径节点的场景、行动和对白，不输出其他节点或流程标记'),
});

export const ScreenplayStepInputSchema = PremiseOutputSchema.extend({
  _context: z.any().optional(),
  userPrompt: z.string().optional(),
});

export type ScreenplayStepInput = z.infer<typeof ScreenplayStepInputSchema>;
