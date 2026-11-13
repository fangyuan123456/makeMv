/**
 * agents/text-game/steps/tech-plan/schema.ts
 * 互动文游技术架构规划契约 (Tech Plan Schema SSOT)
 *
 * 技术方案由模型读策划案与分幕数据后自行规划：分几个文件、每个文件担什么职责、
 * 谁依赖谁。代码生成工序严格按这份规划的依赖拓扑分批推进，不另立骨架。
 */

import { z } from 'zod';
import { UniversalPrdSpecSchema } from '../../../planner/steps/prd-synthesis/schema.js';
import { SingleSceneJsonSchema, StoryScriptSchema } from '../../schema.js';

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

export const TechPlanInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().describe('作品名称'),
  prd: UniversalPrdSpecSchema.describe('阶段一策划案 PRD'),
  scenes: z.array(SingleSceneJsonSchema).describe('已装配好的分幕素材全集（背景图 + 正文）'),
  script: StoryScriptSchema.describe('播放表：每幕的介入点 / 岔口 / 终局 / 下一幕'),
  artStyle: z.string().default('').describe('全剧统一美术画风（决定视觉基调，不做硬编码）'),
});

export type TechPlanInput = z.infer<typeof TechPlanInputSchema>;

export const TechPlanOutputSchema = z.object({
  architectureSummary: z.string().describe('架构总述：分了几层、各层怎么协作、状态怎么流动'),
  files: z.array(TechFileSpecSchema).min(1).describe('工程文件清单（已按依赖拓扑排序，入口在最后）'),
});

export type TechPlanOutput = z.infer<typeof TechPlanOutputSchema>;
