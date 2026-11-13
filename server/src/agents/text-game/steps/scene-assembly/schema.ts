/**
 * agents/text-game/steps/scene-assembly/schema.ts
 * 分幕装配工序契约 (Scene Assembly Schema SSOT)
 */

import { z } from 'zod';
import {
  SingleSceneJsonSchema,
  StoryScriptSchema,
  GlobalEntitiesSchema,
} from '../../schema.js';
import { UniversalPrdSpecSchema } from '../../../planner/steps/prd-synthesis/schema.js';

export const SceneAssemblyInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识（分幕 JSON 按它落盘）'),
  title: z.string().describe('短剧标题'),
  prd: UniversalPrdSpecSchema.describe('Step 4 唯一事实来源通用策划案 PRD'),
  storyMarkdown: z.string().describe('Step 4 交付的按幕剧本全文 story.md（与 prd.clips[].id 1:1 对齐）'),
  lookdev: GlobalEntitiesSchema.describe('已回填 referenceImageUrl 的角色 / 道具 / 场景字典'),
});

export type SceneAssemblyInput = z.infer<typeof SceneAssemblyInputSchema>;

export const SceneAssemblyOutputSchema = z.object({
  scenes: z.array(SingleSceneJsonSchema).min(1).describe('全剧所有分幕素材（背景图 + 正文）'),
  script: StoryScriptSchema.describe('播放表：每幕的介入点 / 岔口 / 终局 / 下一幕'),
  summary: z.string().describe('装配总结，如幕数、场景数、介入点与岔口数量'),
});

export type SceneAssemblyOutput = z.infer<typeof SceneAssemblyOutputSchema>;
