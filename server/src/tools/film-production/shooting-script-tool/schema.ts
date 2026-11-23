/**
 * tools/film-production/shooting-script-tool/schema.ts
 * 导演摄制台本工具契约 (Shooting Script Tool Contract SSOT)
 */

import { z } from 'zod';
import {
  ShootingScriptEnvironmentLockSchema,
  ShootingScriptActionBeatSchema,
} from '../../../project-store/contracts/film-production/film-spec.js';

export const ShootingScriptInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识，格式如 c1'),
  storyMarkdown: z.string().optional().describe('可选剧本正文 Markdown'),
  instruction: z.string().optional().describe('导演视听细化要求（如动作风格、调色光影倾向）'),
  storyOverview: z.string().optional().describe('全剧故事大纲与基调'),
});

export type ShootingScriptInput = z.infer<typeof ShootingScriptInputSchema>;

export const ShootingScriptOutputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识'),
  clipTitle: z.string().describe('分幕标题'),
  environmentLock: ShootingScriptEnvironmentLockSchema.describe('本幕场景时空与光影环境锁'),
  actionBeats: z.array(ShootingScriptActionBeatSchema).min(6).describe('按空间分段、按镜头级摄制单元组织的纯物理动作节拍序列（通常 8~16 镜）'),
});

export type ShootingScriptOutput = z.infer<typeof ShootingScriptOutputSchema>;
