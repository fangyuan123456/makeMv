/**
 * tools/film-production/storyboard-breakdown-tool/modifier/schema.ts
 * 单幕分镜台本微调契约 (Storyboard Breakdown Modifier Contract SSOT)
 */

import { z } from 'zod';
import {
  BreakdownShotItemSchema,
  StoryboardBreakdownOutputSchema,
} from '../steps/01-breakdown/index.js';

export const BreakdownModificationItemSchema = z.object({
  action: z.enum(['add', 'delete', 'update']).describe('操作类型：add=新增镜头，delete=删除镜头，update=更新已有镜头'),
  shotId: z.string().optional().describe('被操作的目标 shotId（update/delete 必填，add 可选作为插入锚点）'),
  shot: BreakdownShotItemSchema.partial().optional().describe('修改或新增的镜头内容（update 时局部覆盖，add 时提供字段）'),
});

export type BreakdownModificationItem = z.infer<typeof BreakdownModificationItemSchema>;

export const StoryboardBreakdownModifierInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识，格式如 c1'),
  instruction: z.string().optional().describe('创作者导演指令（如：增加一个特写镜头、节奏加快、删减镜02）'),
  targetShotId: z.string().optional().describe('在微调模式下指定单镜（若只修改某个镜头的台词或景别）'),
  modifications: z.array(BreakdownModificationItemSchema).optional().describe('结构化增删改操作清单（零 LLM 消耗高精度执行）'),
  storyMarkdown: z.string().optional().describe('剧本或故事正文 Markdown'),
});

export type StoryboardBreakdownModifierInput = z.infer<typeof StoryboardBreakdownModifierInputSchema>;

export const StoryboardBreakdownModifierOutputSchema = StoryboardBreakdownOutputSchema;
export type StoryboardBreakdownModifierOutput = z.infer<typeof StoryboardBreakdownModifierOutputSchema>;
