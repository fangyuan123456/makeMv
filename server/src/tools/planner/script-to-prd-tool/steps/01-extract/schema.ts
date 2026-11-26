/**
 * tools/planner/script-to-prd-tool/steps/01-extract/schema.ts
 * 步骤一：剧本结构语义抽取专属契约 (Extract Step Contract SSOT)
 */

import { z } from 'zod';

export const ScriptToPrdInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识符 (SSOT 必填)'),
  scriptMarkdown: z.string().optional().describe('全景剧本 Markdown 文本 (可选，留空则自动从项目资产黑板读取)'),
  title: z.string().optional().describe('剧作标题 (可选，留空则自动从项目资产读取)'),
});

export type ScriptToPrdInput = z.infer<typeof ScriptToPrdInputSchema>;

export const ExtractedScriptStructureSchema = z.object({
  title: z.string().describe('提取出的剧作标题'),
  clips: z.array(
    z.object({
      id: z.string().describe('切片规范 ID，如 c1, c2, b1_a'),
      title: z.string().describe('切片标题'),
      narrativeText: z.string().describe('切片对应的剧情台词文本'),
      choices: z.array(
        z.object({
          id: z.string().describe('选项 ID，如 ch_1, ch_2'),
          text: z.string().describe('选项文案'),
          targetNodeId: z.string().optional().describe('选项指向的下一个片段 ID'),
          targetEndingId: z.string().optional().describe('选项指向的结局 ID'),
        })
      ).default([]).describe('本片段呈现的选项列表'),
    })
  ).describe('提取的剧情片段切片清单'),
  endings: z.array(
    z.object({
      id: z.string().describe('结局 ID，如 e_he_1, e_be_1'),
      title: z.string().describe('结局标题'),
      endingType: z.enum(['TE', 'HE', 'BE', 'NE', 'SE']).describe('结局类型 (TE=真结局/HE=好结局/BE=坏结局/NE=普通/SE=特殊)'),
      summary: z.string().describe('结局收敛剧情总结'),
    })
  ).describe('提取的所有结局清单'),
});

export type ExtractedScriptStructure = z.infer<typeof ExtractedScriptStructureSchema>;

export const ExtractStepInputSchema = ScriptToPrdInputSchema.extend({
  abortSignal: z.any().optional().describe('取消执行信号量'),
  _context: z.any().optional(),
});

export type ExtractStepInput = z.infer<typeof ExtractStepInputSchema>;
