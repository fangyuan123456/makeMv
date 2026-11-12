/**
 * agents/text-game/steps/codegen/schema.ts
 * 互动文游代码生成工序契约 (Codegen Schema SSOT)
 */

import { z } from 'zod';
import { TechPlanOutputSchema } from '../tech-plan/schema.js';
import { PrdStateValueSchema } from '../../../planner/steps/prd-synthesis/schema.js';

export const CodegenInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().describe('作品名称'),
  techPlan: TechPlanOutputSchema.describe('技术架构规划案'),
  startNodeId: z.string().optional().describe('起始视频节点 ID，默认 S1'),
  initialState: z.record(PrdStateValueSchema).optional().describe('PRD 全局初始状态字典'),
});

export type CodegenInput = z.infer<typeof CodegenInputSchema>;

export const CodegenOutputSchema = z.object({
  projectId: z.string(),
  generatedFiles: z.array(z.string()).describe('已生成的代码源文件路径清单'),
  success: z.boolean(),
});

export type CodegenOutput = z.infer<typeof CodegenOutputSchema>;
