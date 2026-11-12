/**
 * agents/text-game/steps/bundler/schema.ts
 * 互动文游打包工序契约 (Bundler Schema SSOT)
 */

import { z } from 'zod';
import { PrdStateValueSchema } from '../../../planner/steps/prd-synthesis/schema.js';

export const BundlerInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().describe('作品名称'),
  startNodeId: z.string().optional().describe('起始视频节点 ID，默认 S1'),
  initialState: z.record(PrdStateValueSchema).optional().describe('PRD 全局初始状态字典'),
});

export type BundlerInput = z.infer<typeof BundlerInputSchema>;

export const BundlerOutputSchema = z.object({
  projectId: z.string(),
  bundlePath: z.string().describe('生成的目标 bundle.js 本地路径'),
  indexPath: z.string().describe('生成的目标 index.html 本地路径'),
  success: z.boolean(),
});

export type BundlerOutput = z.infer<typeof BundlerOutputSchema>;
