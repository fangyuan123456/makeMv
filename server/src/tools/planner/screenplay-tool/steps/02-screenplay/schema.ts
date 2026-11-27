/**
 * tools/planner/screenplay-tool/steps/02-screenplay/schema.ts
 * 步骤二：全景剧本创作专属契约 (Screenplay Step Contract)
 */

import { z } from 'zod';
import {
  PremiseOutputBaseSchema,
  ScreenplayCharacterSchema,
  type PremiseOutput,
  type ScreenplayCharacter,
} from '../01-premise/schema.js';

export const StructuredActScriptSchema = z.object({
  actNumber: z.number().int().describe('幕次序号（与大纲 actOutlines 一一对应）'),
  sceneHeader: z.string().describe('本幕单母场景与光影氛围定调（仅地点+时间+环境视听，不含“【场景：】”前缀）'),
  narrativeBody: z.string().describe('本幕纯戏剧正文（250~450字：开篇即时承接上一幕动作，经1~2个物理动作与2~4轮锋利潜台词对白，停在互动触发前的悬念起幅瞬间；严禁包含【互动抉择点】【互动钩子】或【终局】标记）'),
});

export type StructuredActScript = z.infer<typeof StructuredActScriptSchema>;

export const StructuredEndingScriptSchema = z.object({
  actNumber: z.number().int().describe('触发该终局的所属幕次序号'),
  outcomeKey: z.string().describe('对应的互动结果键名（如 B / TIMEOUT / A / C）'),
  endingTitle: z.string().describe('终局标题（与大纲 outcomes 中 endingTitle 严格一致）'),
  endingType: z.enum(['TE', 'HE', 'BE', 'NE', 'SE']).describe('终局类型'),
  narrativeText: z.string().describe('专有终局定格结算正文（80~150字：承接该选项物理初速度，交代代价与命运归宿，并给出极具电影视觉象征意味的定格画面）'),
});

export type StructuredEndingScript = z.infer<typeof StructuredEndingScriptSchema>;

export const StructuredScreenplayContentSchema = z.object({
  acts: z.array(StructuredActScriptSchema).min(1).describe('按幕次顺序排列的各幕纯戏剧正文'),
  endings: z.array(StructuredEndingScriptSchema).describe('全剧所有 targetType=ENDING 选项对应的专有终局定格结算列表（每个终局唯一，不重不漏）'),
});

export type StructuredScreenplayContent = z.infer<typeof StructuredScreenplayContentSchema>;

export const ScreenplayOutputSchema = PremiseOutputBaseSchema.extend({
  scriptMarkdown: z.string().describe('完整的 Markdown 格式互动影游全景剧本 (含分幕、台词、抉择选项与分支终局)'),
  structuredContent: StructuredScreenplayContentSchema.optional().describe('结构化分幕与终局正文原始数据'),
});

export type ScreenplayOutput = z.infer<typeof ScreenplayOutputSchema>;

export const FullScriptTextOutputSchema = StructuredScreenplayContentSchema;

export type FullScriptTextOutput = StructuredScreenplayContent;

export const ScreenplayStepInputSchema = PremiseOutputBaseSchema.extend({
  _context: z.any().optional(),
  userPrompt: z.string().optional(),
});

export type ScreenplayStepInput = z.infer<typeof ScreenplayStepInputSchema>;
