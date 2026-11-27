/**
 * project-store/contracts/game-assembly/index.ts
 * 互动影游打包集成强类型契约体系 (SSOT)
 */

import { z } from 'zod';
import {
  InteractionConfigSchema,
  InteractionKindSchema,
  PrdStateChangeSchema,
  PrdStateValueSchema,
} from '../planner/index.js';

export const SingleSceneJsonSchema = z.object({
  sceneId: z.string().describe('幕号，与文件名一致，如 "S1" / "S6.1"'),
  title: z.string().describe('本幕标题，HUD 上显示'),
  background: z.string().describe('画面底图 URL（/media/...），整幕就用这一张'),
  backgrounds: z.array(z.string()).optional().describe('本幕涉及的多个地点背景图'),
  text: z.string().describe('本幕台词正文，\n 分段'),
  clipUrl: z.string().optional().describe('镜头合成后的整幕视频 URL'),
  keyframes: z.array(z.object({ shotId: z.string(), imageUrl: z.string(), durationSec: z.number().positive().optional() })).optional(),
});

export type SingleSceneJson = z.infer<typeof SingleSceneJsonSchema>;

export const ScriptInteractionOutcomeSchema = z.object({
  key: z.string(),
  label: z.string(),
  to: z.string().optional(),
  ending: z.lazy(() => ScriptEndingSchema).optional(),
  stateChange: PrdStateChangeSchema.optional(),
  feedback: z.string().optional(),
});

export const ScriptInteractionSchema = z.object({
  kind: InteractionKindSchema.or(z.string()).describe('介入类型'),
  isBranching: z.boolean().optional().describe('是否命运分支'),
  prompt: z.string().describe('给玩家看的一句操作提示'),
  timeoutSec: z.number().nullable().optional().describe('限时秒数'),
  config: InteractionConfigSchema.optional().describe('玩法专属参数'),
  outcomes: z.array(ScriptInteractionOutcomeSchema).optional().describe('各结果与去向'),
  feedback: z.string().optional().describe('操作完成后的即时反馈文案'),
  stateChange: PrdStateChangeSchema.optional().describe('完成后的状态变更'),
});

export const ScriptChoiceSchema = z.object({
  text: z.string().describe('按钮文案'),
  to: z.string().describe('目标幕号'),
  stateChange: PrdStateChangeSchema.optional().describe('选择后的状态变更'),
});

export const ScriptEndingSchema = z.object({
  type: z.enum(['HE', 'BE', 'NE', 'TE', 'SE']).optional().describe('结局分类'),
  title: z.string().describe('结局名'),
  verdict: z.string().optional().describe('结局判词'),
  rewindTo: z.string().optional().describe('可回溯重选的幕号'),
});

export const ScriptSceneSchema = z.object({
  sceneId: z.string().describe('对应 scenes/<sceneId>.json'),
  title: z.string().describe('幕标题'),
  interaction: ScriptInteractionSchema.nullable().optional(),
  next: z.string().nullable().optional(),
  choices: z.array(ScriptChoiceSchema).optional(),
  ending: ScriptEndingSchema.nullable().optional(),
});

export const StoryScriptSchema = z.object({
  startSceneId: z.string().describe('起始幕号'),
  initialState: z.record(PrdStateValueSchema).default({}),
  scenes: z.array(ScriptSceneSchema),
});

export type StoryScript = z.infer<typeof StoryScriptSchema>;
export type ScriptScene = z.infer<typeof ScriptSceneSchema>;
export type ScriptChoice = z.infer<typeof ScriptChoiceSchema>;
export type ScriptInteraction = z.infer<typeof ScriptInteractionSchema>;
