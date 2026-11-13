/**
 * agents/text-game/steps/codegen/schema.ts
 * 互动影游代码生成工序契约 (Codegen Schema SSOT)
 */

import { z } from 'zod';
import { TechPlanOutputSchema } from '../tech-plan/schema.js';
import { UniversalPrdSpecSchema } from '../../../planner/steps/prd-synthesis/schema.js';
import { SingleSceneJsonSchema, StoryScriptSchema } from '../../schema.js';

export const CodegenInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().describe('作品名称'),
  prd: UniversalPrdSpecSchema.describe('阶段一策划案 PRD（起始幕与初始状态）'),
  techPlan: TechPlanOutputSchema.describe('技术架构规划案（文件划分与依赖拓扑）'),
  scenes: z.array(SingleSceneJsonSchema).default([]).describe('分幕素材全集（背景图 + 正文）'),
  script: StoryScriptSchema.optional().describe('播放表（玩法与路由），缺省时从 scenes/script.json 读盘'),
  startNodeId: z.string().optional().describe('起始幕 sceneId，默认取 PRD.startNodeId'),
});

export type CodegenInput = z.infer<typeof CodegenInputSchema>;

export const CodegenOutputSchema = z.object({
  projectId: z.string(),
  generatedFiles: z.array(z.string()).describe('已落盘的源码文件路径清单'),
  rounds: z.number().describe('实际使用的编码轮次'),
  indexPath: z.string().describe('可玩入口 index.html 的相对路径'),
  success: z.boolean(),
});

export type CodegenOutput = z.infer<typeof CodegenOutputSchema>;
