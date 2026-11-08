/**
 * agents/pipeline/workflows/steps/storyboard/schema.ts
 * 导演视听分镜 Zod 契约规约 (Storyboard Zod SSOT)
 */

import { z } from 'zod';

export const StoryboardShotItemSchema = z.object({
  shotId: z.string().describe('镜头标识，如 shot_1'),
  nodeId: z.string().describe('所属网状剧情节点 ID (如 node_1, node_2)'),
  shotNumber: z.number().describe('镜头全局序号'),
  characterNames: z
    .array(z.string())
    .optional()
    .describe('本镜头实际出镜的角色姓名（必须取自故事圣经 characterNames；空镜填空数组）。用于精确追踪「改了某角色要重做哪些镜头」，不可省略'),
  shotScale: z.enum(['特写', '近景', '中景', '全景', '大远景']).or(z.string()).describe('摄影机景别'),
  cameraMovement: z.string().describe('摄影机运镜动感方式（如 推、拉、摇、移、跟、固定）'),
  cameraTrajectory: z.string().optional().describe('专业物理摄影机轨迹原语（如：平稳向前推近、弧形环绕45度、手持呼吸感跟拍）'),
  subjectMotion: z.string().optional().describe('主体时序微动作（如：眼神微移、随后深吸一口气猛然抬头）'),
  sceneDynamics: z.string().optional().describe('环境物理动态与光影流动（如：雨丝滑落、光斑明暗交替）'),
  durationSec: z.number().min(1).max(30).describe('建议镜头持续秒数 (3~6s)'),
  visualComposition: z.string().describe('视听画面构图与光影透视描述'),
  audioPrompt: z.string().optional().describe('同期声音效与配乐情绪氛围提示'),
});

export type StoryboardShotItem = z.infer<typeof StoryboardShotItemSchema>;

export const StoryboardBatchOutputSchema = z.object({
  shots: z.array(StoryboardShotItemSchema).describe('视听分镜头清单'),
});

export type StoryboardBatchOutput = z.infer<typeof StoryboardBatchOutputSchema>;

export const StoryboardArtifactSchema = z.object({
  title: z.string(),
  shots: z.array(StoryboardShotItemSchema),
  totalShots: z.number(),
  estimatedTotalDurationSec: z.number(),
  createdAt: z.string(),
});

export type StoryboardArtifact = z.infer<typeof StoryboardArtifactSchema>;

export const StoryboardInputSchema = z.object({
  projectId: z.string().describe('项目全局唯一 ID (Project ID)'),
  sessionId: z.string().optional().describe('当前交互会话 ID'),
  userFeedback: z.string().optional().describe('运镜风格或分镜偏好指令'),
}).passthrough();

export type StoryboardInput = z.infer<typeof StoryboardInputSchema>;

export const StoryboardOutputSchema = z.object({
  success: z.boolean(),
  data: StoryboardArtifactSchema.optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
});

export type StoryboardOutput = z.infer<typeof StoryboardOutputSchema>;
