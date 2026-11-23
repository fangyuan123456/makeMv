/**
 * tools/film-production/storyboard-breakdown-tool/steps/01-breakdown/schema.ts
 * 单幕分镜剧本拆分契约 (Storyboard Breakdown Contract SSOT)
 */

import { z } from 'zod';
import { VisualDirectiveSchema } from '../../../../../project-store/contracts/film-production/film-spec.js';

export const BreakdownShotItemSchema = z.object({
  shotId: z.string().describe('镜头唯一标识符，格式如 c1-01'),
  title: z.string().describe('镜头标题，如 镜01 · 老宅门外定场'),
  sceneSubject: z.string().describe('纯净镜头叙事概述（角色在做什么、发生什么事件）'),
  cameraDirective: VisualDirectiveSchema.describe('机位与景别（如：低角度微仰拍、全景、特写）'),
  colorDirective: VisualDirectiveSchema.optional().describe('调色风格（如：民国青灰冷调）'),
  poseDirective: VisualDirectiveSchema.optional().describe('角色瞬间姿态描述'),
  dialogue: z.string().optional().describe('对白台词'),
  audioPrompt: z.string().optional().describe('环境拟音与配乐情绪'),
  durationSec: z.number().positive().default(3).describe('镜头预估时长（秒）'),
  characterIds: z.array(z.string()).default([]).describe('入画角色 ID 清单'),
  itemIds: z.array(z.string()).default([]).describe('入画道具 ID 清单'),
  locationId: z.string().optional().describe('场景 ID'),
});

export type BreakdownShotItem = z.infer<typeof BreakdownShotItemSchema>;

export const StoryboardBreakdownInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识，格式如 c1'),
  storyMarkdown: z.string().optional().describe('剧本或故事正文 Markdown'),
  instruction: z.string().optional().describe('拆分指导意见'),
  storyOverview: z.string().optional().describe('全剧故事大纲与基调'),
  previousClipSummary: z.string().optional().describe('前序分幕因果与角色进入状态'),
  nextClipSummary: z.string().optional().describe('后序分幕预期与戏剧悬念'),
});

export type StoryboardBreakdownInput = z.infer<typeof StoryboardBreakdownInputSchema>;

export const StoryboardBreakdownOutputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识'),
  clipTitle: z.string().describe('分幕标题'),
  shots: z.array(BreakdownShotItemSchema).describe('本幕镜头台本骨架序列'),
});

export type StoryboardBreakdownOutput = z.infer<typeof StoryboardBreakdownOutputSchema>;
