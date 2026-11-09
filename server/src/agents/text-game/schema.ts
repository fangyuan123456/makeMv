/**
 * agents/text-game/schema.ts
 * 可玩互动文游强类型 Zod 契约 (Text Game Content Schema SSOT)
 *
 * 核心设计：
 * 1. 承载顶级文学演出文本 (narrativeText)，充满情景张力、心理与潜台词；
 * 2. 携带选项与状态机变动 (choices & stateMutation)；
 * 3. 前端可玩座舱可直接通过本数据结构进行毫秒级试玩渲染。
 */

import { z } from 'zod';

export const TextGameChoiceSchema = z.object({
  id: z.string().describe('选项唯一标识'),
  text: z.string().describe('选项文本，如：[出示证据] 揭发维克托义眼偷漏数据'),
  requiredFlags: z.array(z.string()).default([]).describe('必须满足的前置旗标门禁'),
  stateMutation: z
    .object({
      variables: z.record(z.number()).optional().default({}),
      flags: z.record(z.boolean()).optional().default({}),
      inventoryAdd: z.array(z.string()).optional().default([]),
      inventoryRemove: z.array(z.string()).optional().default([]),
    })
    .default({}),
  targetNodeId: z.string().describe('选择后跳转的下一个文游节点 ID'),
});

export const SceneVisualSchema = z.object({
  locationId: z.string().optional().describe('关联的场景空间资产 ID，如 loc_interrogation_room'),
  entityIds: z.array(z.string()).optional().default([]).describe('关联出场的角色、生物或关键道具 ID 列表'),
  scenePrompt: z.string().describe('场景环境、光影色调与空间细节描写'),
  characterPrompt: z.string().describe('出场角色外貌、着装细节与当下的肢体动作微表情'),
  composition: z.string().describe('第一视角机位构图 (如 POV 第一人称主观视角，正对铁桌)'),
  imagePromptEn: z.string().describe('标准文生图纯英文母本 Prompt (可直接送给 ComfyUI/Wanx 生成高清首帧参考图)'),
});

export const TextGameNodeSchema = z.object({
  id: z.string().describe('节点唯一标识，如 node_01_interrogation'),
  title: z.string().describe('场景标题'),
  visual: SceneVisualSchema.optional().describe('首帧视觉母本：当前文游立绘配图 + 下游 I2V 视频生成的首帧参考图'),
  narrativeText: z
    .string()
    .describe(
      '高质量第一视角文学演出正文：包含环境氛围描写、生理反应与肢体微动作、带潜台词的机锋对白，极具沉浸感'
    ),
  choices: z.array(TextGameChoiceSchema).default([]).describe('该节点呈现给玩家的抉择分支'),
  audioCue: z.string().optional().describe('环境音效或生理音效提示，如：暴雨雷鸣、心跳加速'),
  isEnding: z.boolean().optional().default(false).describe('是否为故事走向的最终结局节点'),
  endingType: z.enum(['HE', 'BE', 'TE', 'NE']).optional().describe('结局定性 (如 HE 幽灵破晓 / BE 当场处决)'),
});

export const TextGameArtifactSchema = z.object({
  schemaVersion: z.string().default('1.0.0'),
  title: z.string().describe('文游作品名'),
  startNodeId: z.string().describe('文游起始节点 ID'),
  nodes: z.array(TextGameNodeSchema).min(1).describe('文游全量可交互节点图谱'),
});

export type TextGameChoice = z.infer<typeof TextGameChoiceSchema>;
export type SceneVisual = z.infer<typeof SceneVisualSchema>;
export type TextGameNode = z.infer<typeof TextGameNodeSchema>;
export type TextGameArtifact = z.infer<typeof TextGameArtifactSchema>;
