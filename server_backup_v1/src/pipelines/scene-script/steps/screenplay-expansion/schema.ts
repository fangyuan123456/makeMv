/**
 * pipelines/scene-script/steps/screenplay-expansion/schema.ts
 */

import { z } from 'zod';

export const ScreenplayExpansionSchema = z.object({
  screenplayMarkdown: z.string().describe('完整的专业电影级分场剧本Markdown正文'),
  title: z.string().describe('剧本剧集标题'),
  logline: z.string().describe('本集剧情核心大纲梗概'),
  cliffhanger: z.string().optional().describe('本集结尾的断章悬念/危机'),
});

export type ScreenplayExpansionOutput = z.infer<typeof ScreenplayExpansionSchema>;
