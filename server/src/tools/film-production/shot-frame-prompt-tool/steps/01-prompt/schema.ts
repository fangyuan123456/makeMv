/**
 * tools/film-production/shot-prompt-tool/steps/01-prompt/schema.ts
 * 单镜首帧视觉生图提示词推演契约 (Shot Prompt Contract SSOT)
 */

import { z } from 'zod';
import { VisualDirectiveSchema } from '../../../../../project-store/contracts/film-production/film-spec.js';

export const PreviousShotAnchorSchema = z.object({
  shotId: z.string().describe('上一镜头编号'),
  title: z.string().describe('上一镜头标题'),
  shotType: z.string().optional().describe('上一镜头景别与机位'),
  cameraDirective: z.any().optional().describe('上一镜头光学机位指令'),
  sceneSubject: z.string().optional().describe('上一镜头核心事件与角色动作'),
  firstFramePrompt: z.string().optional().describe('上一镜头首帧画面参考'),
  videoLastFrameUrl: z.string().optional().describe('上一镜头视频末帧真实物理截图'),
  videoPrompt: z.string().optional().describe('上一镜头视频运镜与落幅动作'),
});

export type PreviousShotAnchor = z.infer<typeof PreviousShotAnchorSchema>;

export const ShotPromptInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识，格式如 c1'),
  shotId: z.string().describe('镜头唯一标识，格式如 c1-01'),
  continuityMode: z.enum(['auto', 'linked', 'detached']).optional().describe('指定的连续性模式（auto 智能决策 | linked 强制连贯 | detached 独立机位）'),
  instruction: z.string().optional().describe('首帧画面个性化诉求'),
  entities: z.any().optional().describe('可选外观资产快照 (GlobalEntities)'),
  storyOverview: z.string().optional().describe('全剧故事大纲与基调'),
  previousShot: PreviousShotAnchorSchema.optional().describe('前序镜头接戏基准（用于视线轴线与身体姿态承接）'),
});

export type ShotPromptInput = z.infer<typeof ShotPromptInputSchema>;

export const ShotPromptOutputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  clipId: z.string().describe('分幕唯一标识'),
  shotId: z.string().describe('镜头唯一标识'),
  continuityMode: z.enum(['auto', 'linked', 'detached']).optional().describe('本次推演采用的连续性模式'),
  videoPrompt: z.string().describe('全镜视听时序动作流（先行规划：摄影机运镜动向、主体3~5秒内最具表现力的物理动作演进、次级环境物理学）'),
  firstFramePrompt: z.string().describe('电影级纯正向首帧生图词（严格反切自 videoPrompt 第0秒起幅物理瞬间，五层摄影公理构图）'),
  cameraDirective: VisualDirectiveSchema.optional().describe('对齐修正后的机位光学'),
  colorDirective: VisualDirectiveSchema.optional().describe('对齐修正后的调色影调'),
  poseDirective: VisualDirectiveSchema.optional().describe('对齐修正后的人物起幅受力姿态'),
  motionDirective: VisualDirectiveSchema.optional().describe('运镜方式指令'),
  dynamicDirective: VisualDirectiveSchema.optional().describe('动态幅度指令'),
  focusDirective: VisualDirectiveSchema.optional().describe('焦点跟踪指令'),
});

export type ShotPromptOutput = z.infer<typeof ShotPromptOutputSchema>;
