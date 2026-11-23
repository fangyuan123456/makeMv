/**
 * tools/film-production/shooting-script-tool/modifier/schema.ts
 * 导演视听演绎剧本微调契约 (Shooting / Performance Script Modifier Contract SSOT)
 */

import { z } from 'zod';
import {
  ShootingScriptEnvironmentLockSchema,
  ShootingScriptActionBeatSchema,
} from '../../../../project-store/contracts/film-production/film-spec.js';
import { ShootingScriptOutputSchema } from '../schema.js';

export const ShootingScriptModificationItemSchema = z.object({
  action: z.enum(['add', 'delete', 'update']).describe('操作类型：add=新增动作节拍，delete=删除节拍，update=更新已有节拍'),
  beatId: z.string().optional().describe('被操作的目标 beatId（update/delete 必填，add 可选作为插入锚点）'),
  beat: ShootingScriptActionBeatSchema.partial().optional().describe('修改或新增的动作节拍内容'),
});

export type ShootingScriptModificationItem = z.infer<typeof ShootingScriptModificationItemSchema>;

export const ShootingScriptModifierInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识，格式如 c1'),
  mode: z.enum(['modify']).optional().describe('显式微调模式标识'),
  instruction: z.string().optional().describe('导演修改指令（如：把天气改成暴雨夜、主角动作更激烈、删除第2个动作、增加点烟细节）'),
  targetBeatId: z.string().optional().describe('指定修改的目标动作节拍 ID（若只针对单个动作）'),
  environmentLock: ShootingScriptEnvironmentLockSchema.partial().optional().describe('结构化直接覆盖时空环境锁'),
  modifications: z.array(ShootingScriptModificationItemSchema).optional().describe('结构化增删改操作清单（零 LLM 消耗高精度执行）'),
  storyMarkdown: z.string().optional().describe('可选故事正文 Markdown'),
});

export type ShootingScriptModifierInput = z.infer<typeof ShootingScriptModifierInputSchema>;

export const ShootingScriptModifierOutputSchema = ShootingScriptOutputSchema;
export type ShootingScriptModifierOutput = z.infer<typeof ShootingScriptModifierOutputSchema>;
