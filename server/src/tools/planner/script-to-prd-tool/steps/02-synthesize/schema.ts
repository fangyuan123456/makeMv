/**
 * tools/planner/script-to-prd-tool/steps/02-synthesize/schema.ts
 * 步骤二：PRD 汇聚与拓扑校验专属契约 (Synthesize Step Contract)
 */

import { z } from 'zod';
import {
  UniversalPrdSpecSchema,
  StoryGraphSchema,
  type UniversalPrdSpec,
  type StoryGraph,
} from '../../../../../agents/planner/steps/prd-synthesis/schema.js';
import {
  ExtractedScriptStructureSchema,
  type ExtractedScriptStructure,
} from '../01-extract/schema.js';

export const StorySectionItemSchema = z.object({
  title: z.string().describe('分幕/片段标题'),
  narrativeText: z.string().describe('该分幕/片段的完整剧情视听正文与台词'),
});

export type StorySectionItem = z.infer<typeof StorySectionItemSchema>;

export const ScriptToPrdOutputSchema = z.object({
  title: z.string().describe('剧作标题'),
  prd: UniversalPrdSpecSchema.describe('100% 标准化的互动游戏策划案通用规范 (Universal PRD Spec)'),
  storySections: z.record(StorySectionItemSchema).describe('按切片 ID 索引的剧情视听正文字典'),
  graph: StoryGraphSchema.describe('用于前端拓扑图渲染的可视化节点与连线数据'),
  validation: z.object({
    valid: z.boolean().describe('拓扑图论门禁校验是否通过'),
    errors: z.array(z.string()).describe('致命错误列表 (如孤立死胡同、死循环)'),
    warnings: z.array(z.string()).optional().describe('次要警告列表'),
  }).describe('图论门禁校验结果'),
});

export type ScriptToPrdOutput = z.infer<typeof ScriptToPrdOutputSchema>;

export const SynthesizeStepInputSchema = ExtractedScriptStructureSchema.extend({
  _context: z.any().optional(),
});

export type SynthesizeStepInput = z.infer<typeof SynthesizeStepInputSchema>;
