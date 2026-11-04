/**
 * mastra/tools/keyframe-reference/keyframe-reference.tool.ts
 * Mastra 原生 Tool: 关键帧首帧高清图像渲染与单镜头微调自愈 (Keyframe Reference Tool SSOT)
 * 
 * 核心机制：
 * 1. 纯天然微观子工作流直驱：内部驱动 keyframeReferenceSubWorkflow 执行 审计 ➔ 渲染 ➔ 归并；
 * 2. 细粒度断点恢复 (Resume & Skip)：若关键帧已落盘则直接跳过，杜绝重复生图与多余计费；
 * 3. 镜头级靶向微调回退：支持 targetShotId / targetShotIds 指定单/多镜重绘自愈；
 * 4. 产物双向落盘：ProjectStore SSOT 状态黑板 + 本地工程 keyframes/ 物理目录；
 * 5. 原生标记 requireApproval: true 践行人在回路。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  keyframeReferenceSubWorkflow,
  KeyframeSubWorkflowInputSchema,
} from './keyframe-reference.workflow.js';
import { KeyframeReferenceArtifactSchema } from './schema.js';

export const keyframeReferenceTool = createTool({
  id: 'keyframe-reference-generator',
  description: '为视听分镜头表中的每个分镜生成首帧高清剧照参考图，作为后续动态视频生成的一致性基准底图；支持细粒度断点秒级恢复与单镜头靶向微调自愈',
  inputSchema: KeyframeSubWorkflowInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    data: KeyframeReferenceArtifactSchema.optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  requireApproval: true,
  execute: async (params) => {
    try {
      const run = await keyframeReferenceSubWorkflow.createRun();
      const runResult = await run.start({
        inputData: params,
      });

      const stepOutput =
        (runResult as any).result ||
        (runResult as any).steps?.['step-aggregate-keyframe-artifact']?.output;

      if (!stepOutput || stepOutput.success === false || runResult.status !== 'success') {
        const errorMsg =
          (runResult as any).error ||
          stepOutput?.error ||
          `关键帧微观子工作流生成异常 (run status: ${runResult.status})`;
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
        error: err.message || '关键帧参考图生成失败',
      };
    }
  },
});
