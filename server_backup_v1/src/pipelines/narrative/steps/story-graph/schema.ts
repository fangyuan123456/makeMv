/**
 * pipelines/narrative/steps/story-graph/schema.ts
 * 互动网状拓扑图数据契约与校验 Schema (Zod SSOT)
 */

import { z } from 'zod';

export const StoryGraphChoiceSchema = z.object({
  targetNodeId: z.string().describe('分支导向的目标节点 ID'),
  text: z.string().describe('分支选项按钮文案'),
  condition: z.string().optional().describe('前置触发条件或道具线索要求'),
  dramaticTension: z.string().optional().describe('该选择引发的情感或剧情紧张度'),
});

export const StoryGraphNodeSchema = z.object({
  id: z.string().describe('节点唯一标识符，如 node_1'),
  act: z.number().describe('所属幕次'),
  title: z.string().describe('节点剧情标题'),
  summary: z.string().describe('节点剧情详细陈述与视听描述'),
  location: z.string().describe('发生主场景地点'),
  characterNames: z.array(z.string()).describe('登场出镜人物清单'),
  isEnding: z.boolean().optional().default(false).describe('是否为故事收束结局点'),
  endingType: z.enum(['good', 'bad', 'hidden', 'neutral']).optional().describe('结局类型'),
  choices: z.array(StoryGraphChoiceSchema).optional().default([]).describe('从该节点出发的互动选项分支'),
});

export const StoryGraphSchema = z.object({
  rootNodeId: z.string().describe('根节点 ID'),
  nodes: z.array(StoryGraphNodeSchema).min(6).describe('互动剧情拓扑节点数组 (标准规模 6~12 个节点)'),
  endingsCount: z.number().describe('终局数量'),
  estimatedBranches: z.number().describe('总分支路径估计数'),
});

export type StoryGraphData = z.infer<typeof StoryGraphSchema>;
