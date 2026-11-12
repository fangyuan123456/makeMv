/**
 * agents/text-game/steps/tech-plan/schema.ts
 * 互动文游技术架构规划契约 (Tech Plan Schema SSOT)
 */

import { z } from 'zod';

export const TechMethodSpecSchema = z.object({
  name: z.string().describe('方法名'),
  signature: z.string().describe('方法签名与参数类型'),
  description: z.string().describe('功能说明与设计意图'),
});

export const TechClassSpecSchema = z.object({
  className: z.string().describe('类名，如 SceneLoader, StateBlackboard'),
  fileName: z.string().describe('文件名，如 SceneLoader.ts'),
  responsibility: z.string().describe('单一职责说明'),
  dependencies: z.array(z.string()).describe('依赖的其他类或接口文件名列表'),
  methods: z.array(TechMethodSpecSchema).describe('公开核心方法清单'),
});

export type TechClassSpec = z.infer<typeof TechClassSpecSchema>;

export const TechPlanInputSchema = z.object({
  title: z.string().describe('作品名称'),
  genre: z.string().describe('题材定位'),
});

export type TechPlanInput = z.infer<typeof TechPlanInputSchema>;

export const TechPlanOutputSchema = z.object({
  architectureSummary: z.string().describe('技术架构设计总述'),
  classes: z.array(TechClassSpecSchema).min(1).describe('面向对象核心类清单 (拓扑有序)'),
});

export type TechPlanOutput = z.infer<typeof TechPlanOutputSchema>;
