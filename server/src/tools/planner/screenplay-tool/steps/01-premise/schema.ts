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

export const PremiseChoiceSchema = z.object({
  text: z.string().describe('选项文本描述'),
  targetType: z.enum(['CONTINUE_MAINLINE', 'ENDING']).describe('走向类型：CONTINUE_MAINLINE（承担代价并继续推进主线剧情）或 ENDING（走向专有终局结算，彻底拒绝虚假合流）'),
  approachAndCost: z.string().describe('本选项采取的具体手段、过程体验与代价'),
  endingTitle: z.string().optional().describe('若走向 ENDING，注明确切的终局标题（如：【终局：沉默的守夜人】）'),
  endingType: z.enum(['TE', 'HE', 'BE', 'NE', 'SE']).optional().describe('若走向 ENDING，注明确切的终局类型'),
});

export type PremiseChoice = z.infer<typeof PremiseChoiceSchema>;

export const PremiseBranchPointSchema = z.object({
  pointIndex: z.number().int().min(1).max(2).describe('全剧实际选择节点序号，依出现顺序从 1 编号；全剧最多 2 个，不必写满'),
  actNumber: z.number().int().describe('所属幕次序号'),
  sceneContext: z.string().describe('抉择发生时的场景情境与当下危机'),
  dilemma: z.string().describe('玩家面对的核心两难抉择'),
  choiceA: PremiseChoiceSchema.describe('选项 A 规划'),
  choiceB: PremiseChoiceSchema.describe('选项 B 规划'),
});

export type PremiseBranchPoint = z.infer<typeof PremiseBranchPointSchema>;

export const ScreenplayActOutlineSchema = z.object({
  actNumber: z.number().int().describe('幕次序号'),
  title: z.string().describe('本幕标题（如《警报初鸣》、《深渊抉择》）'),
  coreConflict: z.string().describe('本幕核心戏剧冲突矛盾'),
  plotSummary: z.string().describe('【分幕故事脉络】：本幕的核心剧情展开、人物遭遇、关键危机交锋与事件演进脉络（详实且紧凑，约 100-200 字，交代具体事件与冲突推进，拒绝空话与无意义注水）'),
  scenes: z.array(z.string()).describe('本幕包含的关键场景序列与环境视听规划（如：["重症冷冻舱：警报轰鸣中主角艰难破舱，发现仪器全毁与同伴求救信号", "中继回廊：遭遇管线破损漏电与未知生物残骸阻挡"]）'),
  turningPoint: z.string().describe('本幕重大戏剧转折（推动走向互动抉择或引爆下一阶段危机的主导事件）'),
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
  branchPoints: z.array(PremiseBranchPointSchema).max(2).describe('全剧最多 2 个实际供玩家选择的节点，不是每幕或每条路径各 2 个；按剧情需要设计，不为凑数强加选择'),
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
