/**
 * agents/planner/steps/spine-script/schema.ts
 * 黄金主干剧本工序强类型契约 (Spine Script Schema SSOT)
 *
 * 核心哲学：
 * 纯粹认知计算，彻底消灭一切基础设施 ID (零 projectId 污染)！
 * LLM 专属主导文学推演：输入纯需求文本，输出纯剧本作品。
 */

import { z } from 'zod';

export const SpineScriptInputSchema = z.object({
  userPrompt: z.string().describe('创作者输入的创意灵感或故事需求'),
  userToneOrPreference: z.string().optional().describe('创作者指定的风格偏好或补充要求'),
});

export const SpineScriptOutputSchema = z.object({
  title: z.string().describe('推演出的作品中文标题'),
  spineScript: z.string().describe('纯粹连贯的黄金主干短剧剧情 Markdown'),
});

export type SpineScriptInput = z.infer<typeof SpineScriptInputSchema>;
export type SpineScriptOutput = z.infer<typeof SpineScriptOutputSchema>;
