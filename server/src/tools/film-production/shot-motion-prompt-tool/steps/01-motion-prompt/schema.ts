/**
 * tools/film-production/shot-motion-prompt-tool/steps/01-motion-prompt/schema.ts
 * 单镜视频动态与运镜提示词推演契约 (Shot Motion Prompt Contract SSOT)
 */

import { z } from 'zod';
import { VisualDirectiveSchema } from '../../../../../project-store/contracts/film-production/film-spec.js';

export const ShotMotionPromptInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识，格式如 c1'),
  shotId: z.string().describe('镜头唯一标识，格式如 c1-01'),
  instruction: z.string().optional().describe('视频动作与运镜个性化诉求'),
  durationSec: z.number().optional().describe('片段目标时长（秒），默认 8'),
  storyOverview: z.string().optional().describe('全剧故事大纲与基调'),
});

export type ShotMotionPromptInput = z.infer<typeof ShotMotionPromptInputSchema>;

export const ShotMotionPromptOutputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识'),
  shotId: z.string().describe('镜头唯一标识'),
  videoPrompt: z.string().describe('适配 H3 Ref2V 的「人物站位：...」+ 时间戳多机位视频提示词（总时长严格等于段落时长，严禁静态画质废话与旧版起幅套话）'),
  motionDirective: VisualDirectiveSchema.optional().describe('运镜方式指令'),
  dynamicDirective: VisualDirectiveSchema.optional().describe('动态幅度指令'),
  focusDirective: VisualDirectiveSchema.optional().describe('焦点跟踪指令'),
});

export type ShotMotionPromptOutput = z.infer<typeof ShotMotionPromptOutputSchema>;
