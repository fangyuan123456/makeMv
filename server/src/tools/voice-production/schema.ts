/**
 * tools/voice-production/schema.ts
 * 互动影游逐句台词配音与音色锁定制品强类型契约 (Dialogue TTS SSOT)
 *
 * 核心设计准则（ConfirmUI §2 第 10 点）：
 * 1. 独立音频轨：不占 pipeline 阶段工序位，在分场剧本确立后即可并行推进；
 * 2. 全片只锁一次 voiceId：同一角色的 voiceId 贯穿始终，后续逐句仅调节语速 (rate) 与情绪 (emotion)；
 * 3. 严格数据出口契约：用于 ConfirmUI 试听验收与下游视频生成 (口型与时长依据)。
 */

import { z } from 'zod';

export const DialogueEmotionEnum = z.enum([
  'neutral',   // 中性从容
  'angry',     // 愤怒激昂
  'sorrow',    // 悲伤低沉
  'joy',       // 喜悦轻快
  'nervous',   // 紧张急促
  'fear',      // 惊恐战栗
  'whisper',   // 耳语轻声
  'resolute',  // 坚定决绝
]);

export type DialogueEmotion = z.infer<typeof DialogueEmotionEnum>;

/**
 * 单句台词配音切片契约 (Dialogue Segment SSOT)
 */
export const DialogueSegmentSchema = z.object({
  segmentId: z.string().describe('台词切片唯一标识 (如 seg_sc1_01)'),
  sceneId: z.string().optional().describe('所属剧本场次 ID'),
  speaker: z.string().describe('说话角色名称'),
  text: z.string().describe('台词正文文本'),
  voiceId: z.string().describe('音色模型唯一标识 (全片按角色唯一锁定)'),
  rate: z.number().min(0.5).max(2.0).default(1.0).describe('语速系数 (0.5~2.0, 默认为 1.0)'),
  emotion: DialogueEmotionEnum.default('neutral').describe('情感基调'),
  audioUrl: z.string().describe('生成的音频本地沙箱/永久存储 URL'),
  durationSec: z.number().min(0).describe('音频真实持续时长 (秒)，用于视频时序对齐'),
  isDegraded: z.boolean().optional().describe('是否触发降级合成'),
  degradedReason: z.string().optional().describe('降级原因说明'),
  updatedAt: z.string().optional().describe('最新更新时间戳'),
});

export type DialogueSegment = z.infer<typeof DialogueSegmentSchema>;

/**
 * 角色全局音色锁定映射表 (Character Voice Lock SSOT)
 */
export const CharacterVoiceLockMapSchema = z.record(z.string(), z.string()).describe(
  '角色到 voiceId 的唯一锁定映射表，全片全局一致'
);

export type CharacterVoiceLockMap = z.infer<typeof CharacterVoiceLockMapSchema>;

/**
 * 配音验收工件 (Voice Review Artifact SSOT)
 */
export const DialogueVoiceReviewArtifactSchema = z.object({
  projectId: z.string(),
  characterVoices: CharacterVoiceLockMapSchema.describe('已锁定的角色音色库'),
  segments: z.array(DialogueSegmentSchema).describe('全片台词配音切片清单'),
  totalSegments: z.number().describe('台词总句数'),
  totalDurationSec: z.number().describe('配音总时长 (秒)'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DialogueVoiceReviewArtifact = z.infer<typeof DialogueVoiceReviewArtifactSchema>;
