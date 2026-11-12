/**
 * agents/planner/steps/topology-validation/schema.ts
 * 剧情图论拓扑与 100% 通用 PRD 静态门禁校验工序契约 (Topology Validation Schema SSOT)
 */

import { z } from 'zod';
import { SlicedClipNodeSchema } from '../interaction-slicing/schema.js';
import { DerivedBranchNodeSchema } from '../branch-derivation/schema.js';
import { UniversalPrdSpecSchema } from '../prd-synthesis/schema.js';
import { GDDSchema } from '../../schema.js';

export const TopologyValidationMetricsSchema = z.object({
  totalBeats: z.number().describe('总节拍/片段节点数'),
  branchCount: z.number().describe('分叉点节拍数'),
  midStoryForkCount: z.number().describe('中段真分叉数'),
  finaleForkCount: z.number().describe('终局抉择分叉数'),
  endingCount: z.number().describe('独立终局数量'),
  hasLoop: z.boolean().describe('是否具备回溯/循环结构'),
});

export type TopologyValidationMetrics = z.infer<typeof TopologyValidationMetricsSchema>;

export const TopologyValidationInputSchema = z.object({
  title: z.string().describe('作品名称'),
  clips: z.array(SlicedClipNodeSchema).default([]).describe('主干视听片段数组'),
  branches: z.array(DerivedBranchNodeSchema).default([]).describe('推演所得支线片段数组'),
  prd: UniversalPrdSpecSchema.optional().describe('100% 通用 PRD 唯一事实来源'),
  prdMarkdown: z.string().optional().describe('最终渲染的 prd.md 文本'),
  storyMarkdown: z.string().optional().describe('最终渲染的 story.md 文本'),
  gdd: GDDSchema.optional().describe('已装配的标准 GDD 实体 (可选)'),
});

export type TopologyValidationInput = z.infer<typeof TopologyValidationInputSchema>;

export const TopologyValidationOutputSchema = z.object({
  valid: z.boolean().describe('拓扑门禁是否通过'),
  errors: z.array(z.string()).describe('致命阻断缺陷清单'),
  warnings: z.array(z.string()).describe('非致命优化告警'),
  metrics: TopologyValidationMetricsSchema.describe('拓扑结构度量指标'),
  title: z.string(),
  clips: z.array(SlicedClipNodeSchema),
  branches: z.array(DerivedBranchNodeSchema),
  gdd: GDDSchema.optional(),
});

export type TopologyValidationOutput = z.infer<typeof TopologyValidationOutputSchema>;
