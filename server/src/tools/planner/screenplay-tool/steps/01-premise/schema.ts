/**
 * tools/planner/screenplay-tool/steps/01-premise/schema.ts
 * 步骤一：设定与故事大纲专属契约 (Premise Step Contract)
 */

import { z } from 'zod';
import {
  InteractionConfigSchema,
  InteractionKindSchema,
} from '../../../../../project-store/contracts/planner/index.js';

const ScreenplayInputShape = z.object({
  userPrompt: z.string().optional().describe('创作者输入的创意灵感、故事设定或剧本构想'),
  instruction: z.string().optional().describe('创作者提出的局部精修微调指令 (当此项存在时，工具自动走局部文本 Patch 手术流)'),
  targetAct: z.number().int().min(1).max(6).optional().describe('(可选) 明确指定局部微调的幕次序号'),
  genre: z.string().optional().describe('故事题材类型 (如科幻、悬疑探案、中式微恐、权谋古风等)'),
  tone: z.string().optional().describe('视听基调偏好 (如暗黑压抑、快节奏硬核、冷峻电影质感等)'),
  expectedActs: z.number().int().min(2).max(6).default(3).optional().describe('期望故事分幕数量 (默认 3 幕)'),
});

export const ScreenplayInputSchema = ScreenplayInputShape.superRefine((input, ctx) => {
  // 初次生成必须有创作者构想；局部 Patch 通过 instruction 复用已落盘剧本上下文。
  if (!input.instruction?.trim() && !input.userPrompt?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['userPrompt'],
      message: '初次生成剧本必须提供创作者创意构想(userPrompt)，局部修改请使用 instruction',
    });
  }
});

export type ScreenplayInput = z.infer<typeof ScreenplayInputSchema>;

export const ScreenplayCharacterSchema = z.object({
  name: z.string().describe('角色姓名'),
  role: z.string().describe('角色身份/定位 (如主角、神秘线人、反派幕后黑手)'),
  motivation: z.string().describe('核心心理动机与戏剧目标'),
  appearance: z.string().describe('外貌衣着特征与标志性视听符号'),
});

export type ScreenplayCharacter = z.infer<typeof ScreenplayCharacterSchema>;

export const PremiseInteractionOutcomeSchema = z.object({
  key: z.string().describe('结果键名：如 A / B / FOUND / SUCCESS / FAIL / TIMEOUT'),
  label: z.string().describe('展示给玩家的选项文案或结果摘要'),
  targetType: z.enum(['CONTINUE_MAINLINE', 'ENDING']).describe('走向类型：CONTINUE_MAINLINE（推进主线）或 ENDING（走向专有终局）'),
  approachAndCost: z.string().describe('该结果采取的物理动作、去向与代价（若为 CONTINUE_MAINLINE，须与下一幕开篇场景一致）'),
  stateTag: z.string().optional().describe('完成后写入全局状态的标签（如 +ledger），供后续剧情或结局解锁判断'),
  feedback: z.string().optional().describe('完成后的即时反馈文案'),
  endingTitle: z.string().optional().describe('若走向 ENDING，注明确切的终局标题'),
  endingType: z.enum(['TE', 'HE', 'BE', 'NE', 'SE']).optional().describe('若走向 ENDING，注明确切的终局类型'),
});

export type PremiseInteractionOutcome = z.infer<typeof PremiseInteractionOutcomeSchema>;

export const PremiseInteractionSchema = z
  .object({
    pointIndex: z.number().int().min(1).describe('全剧互动节点顺序编号（从 1 开始）'),
    actNumber: z.number().int().describe('所属幕次序号'),
    isBranching: z.boolean().describe('true=命运分支节点（占用全剧 ≤2 个分支名额）；false=零分支单线沉浸互动（0 额外视频成本，完成后统一推进下一幕）'),
    kind: InteractionKindSchema.describe('互动玩法类型：CHOICE / TIMED_CHOICE / SEARCH / HOLD / QTE_TAP / TIMING / CLICK / ACTION_ZONE'),
    prompt: z.string().describe('呈现给玩家的行动指令或抉择提示'),
    timeoutSec: z.number().int().min(3).max(20).nullable().optional().describe('限时秒数（TIMED_CHOICE / 限时 SEARCH / QTE 等按需填写，普通单线可留空）'),
    sceneContext: z.string().describe('互动触发瞬间的物理站位与当下危机（即本幕正文悬念定格点）'),
    config: InteractionConfigSchema.optional().describe('按玩法类型配置的结构化参数（如 SEARCH 的 targets/decoys、HOLD 的 holdDurationMs 等）'),
    outcomes: z.array(PremiseInteractionOutcomeSchema).min(1).describe('结果列表：单线互动至少 1 个 CONTINUE_MAINLINE 结果（可附带 TIMEOUT 状态分支同归下一幕）；命运分支至少 2 个不同走向结果，且至多 1 个 CONTINUE_MAINLINE'),
  })
  .refine(
    (item) =>
      !item.isBranching ||
      item.outcomes.filter((o) => o.targetType === 'CONTINUE_MAINLINE').length <= 1,
    '命运分支节点 (isBranching=true) 至多允许 1 个 CONTINUE_MAINLINE 结果，禁止双线硬合流进同一后续幕'
  );

export type PremiseInteraction = z.infer<typeof PremiseInteractionSchema>;

export const ScreenplayActOutlineSchema = z.object({
  actNumber: z.number().int().describe('幕次序号'),
  title: z.string().describe('本幕标题（如《警报初鸣》、《深渊抉择》）'),
  coreConflict: z.string().describe('本幕核心戏剧冲突矛盾'),
  plotSummary: z.string().describe('【分幕故事脉络】：从承接上一幕互动结果开始，只写到本幕 turningPoint（互动触发起幅点）为止（约 80-150 字），不提前演完互动之后的结果'),
  scenes: z.array(z.string()).describe('本幕核心母场景名称列表（每幕聚焦 1 个核心母场景；若上一幕 CONTINUE_MAINLINE 选项转移了地点，则 scenes[0] 必须与该选项去向一致）'),
  turningPoint: z.string().describe('本幕重大戏剧转折（推动走向互动起幅或引爆下一阶段危机的主导事件）'),
  suspense: z.string().describe('本幕结尾留下的核心悬念或未解谜团'),
});

export type ScreenplayActOutline = z.infer<typeof ScreenplayActOutlineSchema>;

export const PremiseOutputSchema = z.object({
  title: z.string().describe('互动影游中文标题'),
  genre: z.string().describe('题材分类'),
  logline: z.string().describe('一句话核心故事梗概'),
  worldSetting: z.string().describe('世界观背景与既定历史真相（不可改变的客观事实，如灾难发生的原因、空间站物理法则、阵营敌友关系等）'),
  characters: z.array(ScreenplayCharacterSchema).describe('核心角色设定列表'),
  actOutlines: z.array(ScreenplayActOutlineSchema).describe('结构严密、情节详实的分幕大纲清单'),
  interactions: z
    .array(PremiseInteractionSchema)
    .refine(
      (items) => items.filter((item) => item.isBranching).length <= 2,
      '命运分支节点 (isBranching=true) 全剧最多 2 个'
    )
    .describe('全剧幕末互动节点清单（统一包含单线沉浸互动与命运分支；其中 isBranching=true 的节点全剧严格不超过 2 个）'),
});

export type PremiseOutput = z.infer<typeof PremiseOutputSchema>;

export const PremiseStepInputSchema = ScreenplayInputShape.extend({
  _context: z.any().optional(),
}).superRefine((input, ctx) => {
  if (!input.instruction?.trim() && !input.userPrompt?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['userPrompt'],
      message: '初次生成剧本必须提供创作者创意构想(userPrompt)，局部修改请使用 instruction',
    });
  }
});

export type PremiseStepInput = z.infer<typeof PremiseStepInputSchema>;
