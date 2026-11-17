/**
 * tools/planner/screenplay-tool/modifier/schema.ts
 * 剧本文本局部 Patch 手术契约 (Screenplay Modifier Contract SSOT)
 */

import { z } from 'zod';

export const ScreenplayModifierInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识符'),
  instruction: z.string().describe('创作者的局部微调与修改指令，例如“主角改名为阿强”、“在第二幕增加引力撕裂与氧气冲突”'),
  targetAct: z.number().int().min(1).max(6).optional().describe('(可选) 明确指定仅微调的幕次序号'),
});

export type ScreenplayModifierInput = z.infer<typeof ScreenplayModifierInputSchema>;

export const ScreenplayModifierOutputSchema = z.object({
  success: z.boolean().describe('修改是否成功'),
  scriptMarkdown: z.string().describe('Patch 完成后的全景剧本正文 (兼容 asset-sync)'),
  patchedScriptMarkdown: z.string().optional().describe('Patch 完成后的全景剧本正文'),
  summaryOfChanges: z.string().describe('本次局部手术修改点简要说明'),
});

export type ScreenplayModifierOutput = z.infer<typeof ScreenplayModifierOutputSchema>;
