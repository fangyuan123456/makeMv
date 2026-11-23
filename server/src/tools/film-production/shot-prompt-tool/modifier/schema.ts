/**
 * tools/film-production/shot-prompt-tool/modifier/schema.ts
 * 单镜首帧生图词微调契约 (Shot Prompt Modifier Contract SSOT)
 */

import { z } from 'zod';
import { ShotPromptOutputSchema } from '../steps/01-prompt/index.js';

export const ShotPromptModifierInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识，格式如 c1'),
  shotId: z.string().describe('镜头唯一标识，格式如 c1-01'),
  instruction: z.string().optional().describe('个性化画面与视听微调诉求（如：光影更冷、机位侧移、微风吹拂）'),
  customPrompt: z.string().optional().describe('创作者直接指定的首帧生图词（直接采用，跳过 LLM 生成）'),
  customVideoPrompt: z.string().optional().describe('创作者直接指定的视频动态运镜词（直接采用，跳过 LLM 生成）'),
  entities: z.any().optional().describe('可选外观资产快照 (GlobalEntities)'),
});

export type ShotPromptModifierInput = z.infer<typeof ShotPromptModifierInputSchema>;

export const ShotPromptModifierOutputSchema = ShotPromptOutputSchema;
export type ShotPromptModifierOutput = z.infer<typeof ShotPromptModifierOutputSchema>;
