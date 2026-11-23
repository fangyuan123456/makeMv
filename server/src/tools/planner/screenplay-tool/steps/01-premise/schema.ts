/**
 * tools/planner/screenplay-tool/steps/01-premise/schema.ts
 * 步骤一：设定与故事大纲专属契约 (Premise Step Contract)
 */

import { z } from 'zod';

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

export const StoryBibleSchema = z.object({
  causalBackground:z.string().optional(),
  title: z.string(), genre: z.string(), logline: z.string(),
  characters: z.array(ScreenplayCharacterSchema).min(1),
  objectiveTruth: z.array(z.string()).min(1).describe('不可随路线改变的真相、责任人和原因'),
  chronology: z.array(z.string()).min(1).describe('开场之前的客观事件时间线'),
  rules: z.array(z.string()).min(1).describe('物理/超自然规则，所有路线一致'),
  secrets: z.array(z.object({character:z.string(), truth:z.string(), initialBelief:z.string()})),
  initialFacts: z.array(z.string()).min(1).describe('开场地点、在场人、知情范围、道具唯一归属'),
  states: z.array(z.object({key:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), meaning:z.string(), initial:z.boolean()})).max(6),
  endings: z.array(z.object({
    title:z.string(), endingType:z.enum(['HE','BE','NE']),
    necessaryCause:z.string().describe('达成本结局必须发生的因果，不含未必获得的道具'),
    outcome:z.string().describe('最终汇合之后的角色行动与命运；不提前写死中途的营救、取证或物品归属。固定可拍摄，不能写条件画面'),
    when:z.array(z.record(z.boolean())).default([]).describe('满足任意一组键值即可进入；组内所有条件必须满足；各结局互斥且覆盖所有可达状态'),
  })).min(2).max(3),
});
export type StoryBible = z.infer<typeof StoryBibleSchema>;

export const PremiseOutputSchema = z.object({
  title: z.string().describe('互动影游中文标题'),
  genre: z.string().describe('题材分类'),
  logline: z.string().describe('一句话核心故事梗概'),
  characters: z.array(ScreenplayCharacterSchema).describe('核心角色设定列表'),
  sourcePrompt: z.string().optional().describe('原始创作者需求，由执行器透传'),
  storyBible: StoryBibleSchema.optional(),
  initialState: z.record(z.boolean()).optional(),
  startNodeId: z.string().describe('故事入口节点 ID'),
  storyNodes: z.array(z.object({
    id: z.string().min(1).describe('稳定节点 ID，扩写时保留'),
    actNumber: z.number().int().min(1),
    kind: z.enum(['scene', 'ending']),
    endingType: z.enum(['HE', 'BE', 'NE']).optional(),
    contextRole: z.enum(['common','branch','ending']).optional(),
    establishedEvents: z.array(z.string()).optional().describe('所有实际入路都发生过的动作记录，不包含互斥路线'),
    fixedNarrative: z.string().optional().describe('代码生成的共用终局字幕，不交由模型再扩写'),
    choiceIntent: z.object({gain:z.string(),cost:z.string(),payoff:z.string()}).optional(),
    endingResolution: z.object({decisiveAction:z.string(),protagonistFate:z.string(),conflictOutcome:z.string(),finalImage:z.string()}).optional(),
    causalContract: z.object({before:z.record(z.string()),after:z.record(z.string()),requires:z.record(z.string()),effects:z.record(z.string()),unavailableFacts:z.array(z.string())}).optional(),
    mergeContract: z.array(z.string()).optional(),
    nextRoutes: z.array(z.object({when:z.record(z.boolean()),targetNodeId:z.string()})).optional(),
    continuationAction: z.string().optional().describe('自动续接时发生的行动'),
    summary: z.string().describe('本节点确定发生的行动与后果'),
    entryConditions: z.array(z.string()).describe('进入前必须成立的事实；合流时须在每条入路成立'),
    exitConditions: z.array(z.string()).describe('离开时人物位置、知情程度、道具归属等事实'),
    choices: z.array(z.object({ text: z.string(), targetNodeId: z.string(), stateChange:z.object({set:z.record(z.boolean())}).optional(), nextRoutes:z.array(z.object({when:z.record(z.boolean()),targetNodeId:z.string()})).optional() })),
    nextNodeId: z.string().nullable().optional().describe('无选项节点的后继；选择节点及结局省略或为 null'),
  })).min(1).describe('完整分支大纲，包含全部分叉、分支后果、合流和终局'),
  actOutlines: z.array(
    z.object({
      actNumber: z.number().describe('幕次序号'),
      title: z.string().describe('本幕标题'),
      coreConflict: z.string().describe('核心戏剧冲突'),
      suspense: z.string().describe('引发互动的悬念核心'),
    })
  ).describe('各幕大纲概要'),
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
