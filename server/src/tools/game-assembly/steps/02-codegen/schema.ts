/**
 * tools/game-assembly/steps/02-codegen/schema.ts
 * 互动影游代码生成工序契约 (Codegen Step Contract)
 */

import { z } from 'zod';
import { TechPlanStepOutputSchema } from '../01-tech-plan/schema.js';
import { SingleSceneJsonSchema, StoryScriptSchema } from '../../../../project-store/contracts/game-assembly/index.js';

export const CodegenStepInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().optional().describe('作品名称'),
  prd: z.any().optional().describe('策划案 PRD (UniversalPrdSpec)'),
  techPlan: TechPlanStepOutputSchema.optional().describe('技术架构规划案（文件划分与依赖拓扑）'),
  scenes: z.array(SingleSceneJsonSchema).default([]).describe('分幕素材全集（背景图 + 正文）'),
  script: StoryScriptSchema.optional().describe('播放表（玩法与路由）'),
  startNodeId: z.string().optional().describe('起始幕 sceneId'),
});

export type CodegenStepInput = z.infer<typeof CodegenStepInputSchema>;

export const CodegenStepOutputSchema = z.object({
  projectId: z.string(),
  generatedFiles: z.array(z.string()).describe('已落盘的源码文件路径清单'),
  rounds: z.number().describe('实际使用的编码轮次'),
  indexPath: z.string().describe('可玩入口 index.html 的相对路径'),
  success: z.boolean(),
});

export type CodegenStepOutput = z.infer<typeof CodegenStepOutputSchema>;
