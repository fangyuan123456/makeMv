/**
 * tools/game-assembly/steps/01-tech-plan/schema.ts
 * 互动影游技术架构规划契约 (Tech Plan Step Contract)
 */

import { z } from 'zod';
import { SingleSceneJsonSchema, StoryScriptSchema } from '../../../../project-store/contracts/game-assembly/index.js';

export const TechMethodSpecSchema = z.object({
  name: z.string().describe('方法名，如 renderScene'),
  signature: z.string().describe('方法签名与参数，如 (scene, onDone)'),
  description: z.string().describe('这个方法的职责与关键行为'),
});

export const TechSymbolSpecSchema = z.object({
  name: z.string().describe('导出的类名 / 函数名 / 常量名'),
  kind: z.enum(['class', 'function', 'const']).describe('符号种类'),
  purpose: z.string().describe('该符号承担什么'),
  methods: z.array(TechMethodSpecSchema).default([]).describe('对外方法清单（class 才有，其余留空）'),
});

export const TechFileSpecSchema = z.object({
  fileName: z.string().describe('文件名，如 StateBlackboard.js / style.css'),
  kind: z.enum(['js', 'css']).describe('js = 浏览器直接加载的 ES module，css = 视觉样式'),
  responsibility: z.string().describe('这个文件唯一负责的事，一句话说清'),
  dependencies: z
    .array(z.string())
    .default([])
    .describe('import 的其它 js 文件名（必须出现在本规划里），css 恒为空'),
  symbols: z.array(TechSymbolSpecSchema).default([]).describe('该文件对外提供的符号清单'),
});

export type TechFileSpec = z.infer<typeof TechFileSpecSchema>;
export type TechSymbolSpec = z.infer<typeof TechSymbolSpecSchema>;
export type TechMethodSpec = z.infer<typeof TechMethodSpecSchema>;

export const TechPlanStepInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().optional().describe('作品名称'),
  prd: z.any().optional().describe('策划案 PRD (UniversalPrdSpec)'),
  scenes: z.array(SingleSceneJsonSchema).optional().describe('已装配好的分幕素材全集'),
  script: StoryScriptSchema.optional().describe('播放表：每幕的介入点 / 岔口 / 终局 / 下一幕'),
  artStyle: z.string().default('').describe('全剧统一美术画风'),
});

export type TechPlanStepInput = z.infer<typeof TechPlanStepInputSchema>;

export const TechPlanStepOutputSchema = z.object({
  architectureSummary: z.string().describe('架构总述：分了几层、各层怎么协作、状态怎么流动'),
  files: z.array(TechFileSpecSchema).min(1).describe('工程文件清单（已按依赖拓扑排序，入口在最后）'),
});

export type TechPlanStepOutput = z.infer<typeof TechPlanStepOutputSchema>;
