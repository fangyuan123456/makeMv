/**
 * skills/story-bible/schema.ts
 * 故事圣经阶段 Zod Schema 规约定义 (Story Bible Zod SSOT)
 */

import { z } from 'zod';

// 1. 黄金三幕主干 Schema
export const GoldenSpineActSchema = z.object({
  act: z.number().describe('幕次序号 (1, 2, 3...)'),
  name: z.string().describe('幕次名称，如：开端与危机降临'),
  summary: z.string().describe('本幕剧情发展与高潮概要'),
  targetDurationSec: z.number().optional().default(60).describe('建议时长秒数'),
  cliffhanger: z.string().optional().describe('本幕结尾悬念钩子'),
});

export const StorySpineSchema = z.object({
  title: z.string().describe('互动影游商业化项目主标题'),
  theme: z.string().describe('核心哲学与戏剧冲突主题'),
  style: z.string().describe('视觉与影调基调说明'),
  logline: z.string().describe('一句话核心故事大纲 (Logline)'),
  sellingPoints: z.array(z.string()).min(1).describe('核心看点与商业卖点清单'),
  goldenSpine: z.array(GoldenSpineActSchema).min(3).describe('三幕或多幕黄金戏剧骨架'),
});

export type StorySpineOutput = z.infer<typeof StorySpineSchema>;

// 2. 核心分支抉择点 Schema
export const MacroChoiceSchema = z.object({
  choiceId: z.string().describe('选项唯一标识，如 choice_1'),
  text: z.string().describe('抉择选项呈现文本'),
  dramaticImpact: z.string().describe('该选择引发的直接戏剧走向与代价'),
  targetAct: z.number().optional().describe('预期导向的幕次序号'),
});

export const MacroPivotPointSchema = z.object({
  id: z.string().describe('抉择点 ID，如 pivot_1'),
  act: z.number().describe('所属幕次'),
  decisionMoment: z.string().describe('核心危机抉择时刻情境描述'),
  choices: z.array(MacroChoiceSchema).min(2).describe('至少两个互斥且动机强烈的选项'),
});

export const MicroPivotPointSchema = z.object({
  id: z.string().describe('微观交互 ID'),
  sceneName: z.string().describe('发生场景'),
  interactiveMechanic: z.string().describe('交互操作机制 (如 QTE、线索搜查、眼神比对)'),
  feedback: z.string().describe('玩家操作带来的视听反馈'),
});

export const PivotPointsSchema = z.object({
  macroPivotPoints: z.array(MacroPivotPointSchema).min(1).describe('宏观剧情分支抉择点'),
  microPivotPoints: z.array(MicroPivotPointSchema).optional().default([]).describe('场景微观即时交互点'),
});

export type PivotPointsOutput = z.infer<typeof PivotPointsSchema>;

// 3. 有向无环网状剧情图谱 Schema
export const StoryGraphNodeChoiceSchema = z.object({
  targetNodeId: z.string().describe('目标剧情节点 ID'),
  text: z.string().describe('分支选项呈现文案'),
  condition: z.string().optional().describe('触发前置条件'),
  dramaticTension: z.string().optional().describe('戏剧张力说明'),
});

export const StoryGraphNodeSchema = z.object({
  id: z.string().describe('节点唯一标识，如 node_1'),
  act: z.number().describe('所属幕次'),
  title: z.string().describe('节点标题'),
  summary: z.string().describe('节点剧情梗概与关键冲突'),
  location: z.string().describe('发生主要空间/场景'),
  characterNames: z.array(z.string()).describe('登场出镜人物姓名'),
  isEnding: z.boolean().optional().default(false).describe('是否为全片终局'),
  endingType: z.enum(['good', 'bad', 'hidden', 'neutral']).optional().describe('终局类型'),
  choices: z.array(StoryGraphNodeChoiceSchema).optional().default([]).describe('下游分支选项，终局节点为空'),
});

export const StoryGraphSchema = z.object({
  rootNodeId: z.string().describe('故事开始的根节点 ID'),
  nodes: z.array(StoryGraphNodeSchema).min(3).describe('全网剧情节点清单'),
  endingsCount: z.number().describe('可达成的结局数量'),
  estimatedBranches: z.number().describe('分支走向预估数'),
});

export type StoryGraphOutput = z.infer<typeof StoryGraphSchema>;

// 4. 核心角色小传档案 Schema
export const CharacterProfileSchema = z.object({
  name: z.string().describe('角色姓名'),
  role: z.string().describe('剧中身份定位（如男主角、反派BOSS、神秘线人）'),
  gender: z.string().optional().describe('性别'),
  age: z.union([z.number(), z.string()]).optional().describe('年龄'),
  appearance: z.string().describe('具体视觉外貌描写（发型、面容特征、体态衣着）'),
  personality: z.string().describe('性格特征与心理弱点'),
  motivation: z.string().describe('核心欲望与驱动动机'),
  arc: z.string().optional().describe('人物成长弧光'),
  visualPromptKeywords: z.array(z.string()).optional().describe('用于生图的视觉锚点关键词'),
});

export const CharacterProfilesListSchema = z.object({
  characters: z.array(CharacterProfileSchema).min(1).describe('核心角色小传列表'),
});

export type CharacterProfilesListOutput = z.infer<typeof CharacterProfilesListSchema>;
