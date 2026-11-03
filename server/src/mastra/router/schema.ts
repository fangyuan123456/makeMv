/**
 * mastra/router/schema.ts
 * 导演动态路由决策与人在回路提案 Zod 契约规约 (Router Schema SSOT)
 */

import { z } from 'zod';

export const RouterIntentEnum = z.enum([
  'CHAT',                // 纯剧情研讨、设定分析与自然语言交流
  'PROPOSE_ACTION',      // 提议执行完整工序或局部单点自愈（如单角色重绘、单场重写、生成分镜）
  'INVOKE_CRITIC',       // 提议召唤影视独立审查官进行跨工序挑刺质检
]);

export type RouterIntent = z.infer<typeof RouterIntentEnum>;

export const RouterProposalSpecSchema = z.object({
  skill: z.enum([
    'story-bible',
    'character-portrait',
    'scene-script',
    'storyboard',
    'keyframe-reference',
    'video-production',
    'critic-review',
    'fmv-packaging',
  ]).describe('拟调用的 Mastra Tool / Skill 标识'),
  actionType: z.string().describe('行动类别（如 FULL_GENERATION, TARGETED_REVISE, CRITIC_AUDIT, FMV_PACKAGING）'),
  label: z.string().describe('行动高亮标题（渲染于 UI 卡片，如“重绘李默短发定妆照”、“视听分镜生成”）'),
  description: z.string().describe('行动详细说明与改动预期'),
  targetStage: z.string().describe('对应的状态图工序阶段'),
  payload: z.record(z.string(), z.any()).default({}).describe('工具调用的具体参数快照'),
});

export type RouterProposalSpec = z.infer<typeof RouterProposalSpecSchema>;

export const DirectorRouterDecisionSchema = z.object({
  thought: z.string().describe('导演副手的思维链思考推演过程（分析创作者意图与当前状态图依赖）'),
  reply: z.string().describe('面向人类创作者的专业导演回复文案，富有视听画面感与专业建议'),
  intent: RouterIntentEnum.describe('决策意图分类'),
  proposal: RouterProposalSpecSchema.optional().describe('若需要执行带有副作用或消耗算力的工序，抛出人在回路待审提案'),
});

export type DirectorRouterDecision = z.infer<typeof DirectorRouterDecisionSchema>;
