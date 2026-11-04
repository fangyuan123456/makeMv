/**
 * mastra/tools/character-portrait/character-portrait.tool.ts
 * Mastra 原生 Tool: 角色视觉定妆照生成与微调自愈 (Character Portrait Tool SSOT)
 * 
 * 核心机制：
 * 1. 纯天然微观子工作流直驱：内部驱动 characterPortraitSubWorkflow 执行 审计 ➔ 渲染 ➔ 归并；
 * 2. 细粒度断点恢复 (Resume & Skip)：若定妆图已落盘则直接跳过，杜绝重复生图与多余计费；
 * 3. 角色级靶向微调回退：支持 targetCharacterNames 指定单/多角色重绘自愈；
 * 4. 产物双向落盘：ProjectStore SSOT 状态黑板 + 本地工程 characters/ 物理目录；
 * 5. 原生标记 requireApproval: true 践行人在回路。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  characterPortraitSubWorkflow,
  CharacterSubWorkflowInputSchema,
} from './character-portrait.workflow.js';
import { CharacterPortraitArtifactSchema } from './schema.js';

export const characterPortraitTool = createTool({
  id: 'character-portrait-generator',
  description: '为故事圣经中确立的所有核心主角与重要配角推演影视级视觉定妆提示词并批量生成高清人物定妆照，支持细粒度断点秒级恢复与单角色靶向微调自愈',
  inputSchema: CharacterSubWorkflowInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    data: CharacterPortraitArtifactSchema.optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  requireApproval: true,
  execute: async (params) => {
    try {
      const run = await characterPortraitSubWorkflow.createRun();
      const runResult = await run.start({
        inputData: params,
      });

      const stepOutput =
        (runResult as any).result ||
        (runResult as any).steps?.['step-aggregate-portrait-artifact']?.output;

      if (!stepOutput || stepOutput.success === false || runResult.status !== 'success') {
        const errorMsg =
          (runResult as any).error ||
          stepOutput?.error ||
          `角色定妆微观子工作流生成异常 (run status: ${runResult.status})`;
        return {
          success: false,
          error: errorMsg,
        };
      }

      return {
        success: true,
        data: stepOutput.data,
        summary: stepOutput.summary,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || '角色定妆生成失败',
      };
    }
  },
});
