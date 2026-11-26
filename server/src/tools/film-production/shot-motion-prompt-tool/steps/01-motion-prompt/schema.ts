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
  firstFramePrompt: z.string().optional().describe('首帧静态生图词参考（起幅锚点）'),
  firstFrameImageUrl: z.string().optional().describe('首帧已落盘实拍图路径（视觉锚点）'),
  durationSec: z.number().optional().describe('镜头目标时长（秒），默认 4'),
  storyOverview: z.string().optional().describe('全剧故事大纲与基调'),
});

export type ShotMotionPromptInput = z.infer<typeof ShotMotionPromptInputSchema>;

export const ShotMotionPromptOutputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识'),
  shotId: z.string().describe('镜头唯一标识'),
  videoPrompt: z.string().describe('以“从起幅定格连贯演进：”开头，严格按当前镜头时长与景别动能分级（LOD）描摹摄影机运镜、环境流体与匹配景别的动作演进（远景/全景严禁呼吸起伏/喉结/眼神微动），120~180字'),
  motionDirective: VisualDirectiveSchema.optional().describe('运镜方式指令'),
  dynamicDirective: VisualDirectiveSchema.optional().describe('动态幅度指令'),
  focusDirective: VisualDirectiveSchema.optional().describe('焦点跟踪指令'),
});

export type ShotMotionPromptOutput = z.infer<typeof ShotMotionPromptOutputSchema>;
