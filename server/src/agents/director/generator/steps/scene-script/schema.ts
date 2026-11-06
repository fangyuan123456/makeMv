/**
 * agents/pipeline/workflows/steps/scene-script/schema.ts
 * 分场多分支剧本 Zod 契约规约 (Scene Script Zod SSOT)
 */

import { z } from 'zod';

export const DialogueLineSchema = z.object({
  speaker: z.string().describe('说话角色姓名'),
  line: z.string().describe('对白台词内容'),
  parenthetical: z.string().optional().describe('动作神态提示/潜台词括号'),
});

export type DialogueLine = z.infer<typeof DialogueLineSchema>;

export const ScriptSceneNodeSchema = z.object({
  nodeId: z.string().describe('绑定的网状剧情节点 ID (如 node_1)'),
  act: z.number().describe('所属幕次序号'),
  sceneTitle: z.string().describe('场次标题'),
  location: z.string().describe('发生物理场景与空间'),
  timeOfDay: z.string().describe('时间与自然光线 (如 日内、雨夜、黄昏)'),
  actionSummary: z.string().describe('场景动作、视听气氛与环境描写'),
  dialogues: z.array(DialogueLineSchema).describe('本场戏核心角色对白交锋清单'),
  interactionMoment: z.string().optional().describe('本场戏关键交互或抉择时刻描写'),
});

export type ScriptSceneNode = z.infer<typeof ScriptSceneNodeSchema>;

export const SceneScriptBatchOutputSchema = z.object({
  scenes: z.array(ScriptSceneNodeSchema).describe('分场多分支剧本列表'),
});

export type SceneScriptBatchOutput = z.infer<typeof SceneScriptBatchOutputSchema>;

export const SceneScriptArtifactSchema = z.object({
  title: z.string(),
  scenes: z.array(ScriptSceneNodeSchema),
  totalScenes: z.number(),
  createdAt: z.string(),
});

export type SceneScriptArtifact = z.infer<typeof SceneScriptArtifactSchema>;

export const SceneScriptInputSchema = z.object({
  projectId: z.string().describe('项目全局唯一 ID (Project ID)'),
  sessionId: z.string().optional().describe('当前交互会话 ID'),
  userFeedback: z.string().optional().describe('剧本台词或节奏偏好说明'),
}).passthrough();

export type SceneScriptInput = z.infer<typeof SceneScriptInputSchema>;

export const SceneScriptOutputSchema = z.object({
  success: z.boolean(),
  data: SceneScriptArtifactSchema.optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
});

export type SceneScriptOutput = z.infer<typeof SceneScriptOutputSchema>;
