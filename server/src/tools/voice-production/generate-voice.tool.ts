/**
 * mastra/tools/voice-production/generate-voice.tool.ts
 * Mastra 原生原子工具: 单句台词配音生成与逐句微调自愈 (Generate Voice Tool SSOT)
 *
 * 核心机制（ConfirmUI §6 原子资产工具族规范）：
 * 1. 继承 createTool，声明强类型 Zod 校验；
 * 2. requireApproval: true 满足人在回路可控性；
 * 3. 工具间不逆向调用，缺输入则抛出让上游补齐；
 * 4. 全片角色仅锁一次 voiceId，逐句调用时继承已锁定音色，主要调节 rate (0.5~2.0) 与 emotion；
 * 5. 产物直接落盘本地媒体库并同步更新 ProjectStore 的 voice_review 产物。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { VoiceRenderer } from './voice.renderer.js';
import {
  DialogueSegmentSchema,
  DialogueEmotionEnum,
  type DialogueSegment,
  type DialogueVoiceReviewArtifact,
} from './schema.js';

export const generateVoiceInputSchema = z.object({
  projectId: z.string().describe('项目全局唯一 ID'),
  sessionId: z.string().optional().describe('当前交互会话 ID'),
  segmentId: z.string().describe('待录制/重录的台词片段标识 (如 seg_sc1_01)'),
  sceneId: z.string().optional().describe('所属场次标识'),
  speaker: z.string().describe('说话角色名'),
  text: z.string().min(1).describe('台词正文内容'),
  voiceId: z.string().optional().describe('指定的音色标识，若未传则自动继承该角色已锁定的 voiceId'),
  rate: z.number().min(0.5).max(2.0).default(1.0).describe('语速系数 (0.5~2.0)'),
  emotion: DialogueEmotionEnum.default('neutral').describe('情感基调'),
  userFeedback: z.string().optional().describe('创作者针对该句微调的定向要求'),
  isMock: z.boolean().optional().describe('是否使用 Mock 离线快速合成'),
}).strict();

export const generateVoiceOutputSchema = z.object({
  success: z.boolean(),
  segment: DialogueSegmentSchema.optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
});

export const generateVoiceTool = createTool({
  id: 'generate-voice',
  description: '原子配音工具：为剧本指定角色逐句生成/重录电影级情感配音音频，支持语速与情感动态微调',
  inputSchema: generateVoiceInputSchema,
  outputSchema: generateVoiceOutputSchema,
  requireApproval: true,
  execute: async (params) => {
    try {
      const {
        projectId,
        sessionId,
        segmentId,
        sceneId,
        speaker,
        text,
        rate = 1.0,
        emotion = 'neutral',
        isMock = false,
      } = params;

      const store = ProjectStore.getInstance();
      const project = store.getProject(projectId);
      if (!project) {
        throw new Error(`[generateVoiceTool] 未找到目标项目: ${projectId}`);
      }

      // 1. 全局音色锁解析 (SSOT)：全片优先复用该角色已锁定的 voiceId
      const voiceArtifact = store.getArtifact<DialogueVoiceReviewArtifact>(projectId, 'voice_review') || {
        projectId,
        characterVoices: {},
        segments: [],
        totalSegments: 0,
        totalDurationSec: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const lockedVoiceId = voiceArtifact.characterVoices[speaker];
      const effectiveVoiceId = params.voiceId || lockedVoiceId || `voice_zh_${speaker.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'char'}_cinematic`;

      // 2. 锁定音色到角色库（全片只锁一次，后续逐句继承）
      if (!voiceArtifact.characterVoices[speaker]) {
        voiceArtifact.characterVoices[speaker] = effectiveVoiceId;
        console.log(`[generateVoiceTool] 角色【${speaker}】全片配音音色已锁定为: ${effectiveVoiceId}`);
      }

      // 3. 执行音频合成与物理文件落盘 (委托 VoiceRenderer)
      const renderRes = await VoiceRenderer.renderAudioClip(projectId, segmentId, text, {
        rate,
        emotion,
        isMock,
      });

      // 4. 构建单句标准产物
      const now = new Date().toISOString();
      const newSegment: DialogueSegment = {
        segmentId,
        sceneId,
        speaker,
        text,
        voiceId: effectiveVoiceId,
        rate,
        emotion,
        audioUrl: renderRes.audioUrl,
        durationSec: renderRes.durationSec,
        isDegraded: renderRes.isDegraded,
        updatedAt: now,
      };

      // 5. 更新全片配音工件 (voice_review)
      const existingIdx = voiceArtifact.segments.findIndex((s: any) => s.segmentId === segmentId);
      if (existingIdx !== -1) {
        voiceArtifact.segments[existingIdx] = newSegment;
      } else {
        voiceArtifact.segments.push(newSegment);
      }

      voiceArtifact.totalSegments = voiceArtifact.segments.length;
      voiceArtifact.totalDurationSec = Math.round(
        voiceArtifact.segments.reduce((acc: number, s: any) => acc + (s.durationSec || 0), 0) * 10
      ) / 10;
      voiceArtifact.updatedAt = now;

      // 双向落盘状态黑板
      store.setArtifact(projectId, 'voice_review', voiceArtifact);

      // 反向同步音色偏好至白板
      if (sessionId) {
        const lockedList = Object.entries(voiceArtifact.characterVoices)
          .map(([name, vid]) => `${name}:${vid}`)
          .join('、');
        store.updateScratchpad(projectId, sessionId, {
          audioAndVoicePreferences: `已锁定音色库: [${lockedList}]。全片已录制 ${voiceArtifact.totalSegments} 句 (总时长 ${voiceArtifact.totalDurationSec}s)`,
        });
      }

      const summary = `🎙️ 台词 [${segmentId}](${speaker}) 配音重录交付完成 (音色: ${effectiveVoiceId}, 语速: ${rate}x, 情绪: ${emotion}, 时长: ${renderRes.durationSec}s)`;

      return {
        success: true,
        segment: newSegment,
        summary,
      };
    } catch (err: any) {
      console.error('[generateVoiceTool] 配音合成异常:', err);
      return {
        success: false,
        error: err.message || '台词配音生成异常',
      };
    }
  },
});
