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
  success: z.boolean().default(true).describe('修改是否成功'),
  scriptMarkdown: z.string().describe('Patch 完成后的全景剧本正文 (完整 Markdown 文本)'),
  patchedScriptMarkdown: z.string().optional().describe('Patch 完成后的全景剧本正文 (兼容字段)'),
  summaryOfChanges: z.string().default('已完成局部精修').describe('本次局部手术修改点简要说明'),
});

export type ScreenplayModifierOutput = z.infer<typeof ScreenplayModifierOutputSchema>;

export const StructuredActPatchSchema = z.object({
  actNumber: z.number().int().describe('需要修改的幕次序号'),
  sceneHeader: z.string().optional().describe('仅当需要调整本幕单母场景或氛围时填写的新场景定调（不含【场景：】前缀）'),
  narrativeBody: z.string().describe('修改后的本幕纯戏剧正文（严禁包含【互动抉择点】【互动钩子】或【终局】标记）'),
});

export const StructuredEndingPatchSchema = z.object({
  actNumber: z.number().int().describe('该终局所属的幕次序号'),
  outcomeKey: z.string().describe('对应的互动结果键名（如 B / TIMEOUT / A / C）'),
  narrativeText: z.string().describe('修改后的专有终局定格结算正文（80~150字）'),
});

export const StructuredScreenplayPatchOutputSchema = z.object({
  summaryOfChanges: z.string().describe('简要总结本次局部手术的具体改动点 (100 字内)'),
  actPatches: z.array(StructuredActPatchSchema).default([]).describe('仅列出需要修改的幕次（未修改的幕次不要输出，系统会原封不动保留）'),
  endingPatches: z.array(StructuredEndingPatchSchema).default([]).describe('仅列出需要修改的终局文案（未修改的终局不要输出，系统会原封不动保留）'),
});

export type StructuredScreenplayPatchOutput = z.infer<typeof StructuredScreenplayPatchOutputSchema>;
