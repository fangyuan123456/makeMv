/**
 * agents/director/schema.ts
 * AI 导演副手原生 Tool Calling 与行动提案 Zod 契约规约 (Director Zod SSOT)
 */

import { z } from 'zod';
import { tool } from 'ai';

// 1. 提案具体执行入参 Schema (深度承接创作者在探讨中的推敲拍板与局部微调指示)
export const ProposeActionParamsSchema = z.object({
  isRefinement: z.boolean().optional().default(false).describe(
    '🌟 关键状态机标识：本次行动是否为对当前已有产物的局部修改/重画/微调(true)，而非首次推进进入新工序(false)。当创作者要求微调、重修某镜头或角色时，必须显式设为 true，以防止误推进阶段状态机！'
  ),
  targetShotId: z.string().optional().describe('若创作者指定修改特定分镜/镜头，填写该镜头唯一标识(如 shot_3)'),
  targetCharacterNames: z.array(z.string()).optional().describe('针对定妆工序指定的角色名列表'),
  userFeedback: z.string().optional().describe('提炼总结创作者在近期探讨中提出的所有具体修改指示与设定要求'),
  styleOverride: z.string().optional().describe('覆盖或强化的视觉影调风格'),
}).passthrough().describe('具体执行参数');

// 2. 导演发起阶段工序行动提案 Schema (propose_stage_action)
// 🌟 纯动态插件化微内核：skill 保持动态字符串，由 SkillRegistry 动态发现与单例刚性门禁校验，彻底消除硬编码数组
export const ProposeStageActionSchema = z.object({
  skill: z.string().describe('要执行的目标工序技能唯一标识名 (必须完全对应当前已挂载技能清单中的 skillName)'),
  label: z.string().describe('卡片行动标题，如 一键生成角色视觉定妆照'),
  description: z.string().optional().describe('行动说明与推进理由'),
  params: ProposeActionParamsSchema.optional().describe('具体执行参数'),
});

export type ProposeActionParams = z.input<typeof ProposeActionParamsSchema>;
export type ProposeStageActionInput = z.input<typeof ProposeStageActionSchema>;

// 3. 预编译的 Vercel AI SDK 原生 Tool 实例单例
export const proposeStageActionTool = tool({
  description: '当与创作者推敲成熟、或者创作者明确拍板进入下一工序时，向创作者发起当前工序执行提案卡片',
  inputSchema: ProposeStageActionSchema,
});
