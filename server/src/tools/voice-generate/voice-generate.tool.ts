/**
 * tools/voice-generate/voice-generate.tool.ts
 * 真实物理算力：角色台词语音合成工具 (Voice Generate Tool SSOT)
 * 供全剧组 (PipelineAgent / ModifierAgent / Workflow Steps) 公共调度
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { VoiceRenderer } from '../../media/index.js';

export const VoiceGenerateInputSchema = z.object({
  projectId: z.string().describe('项目全局唯一 ID'),
  segmentId: z.string().describe('台词语音段落唯一标识'),
  text: z.string().describe('需要合成台词文本'),
  characterName: z.string().optional().describe('说话的角色名称'),
  rate: z.number().default(1.0).describe('语速调节系数 (0.5 ~ 2.0)'),
  emotion: z.string().optional().describe('情感语气'),
  isMock: z.boolean().optional().describe('是否处于 Mock 预演测试模式'),
});

export const VoiceGenerateOutputSchema = z.object({
  success: z.boolean(),
  audioUrl: z.string().optional().describe('合成后的音频文件本地 URL'),
  durationSec: z.number().optional().describe('音频时长 (秒)'),
  error: z.string().optional(),
});

export const voiceGenerateTool = createTool({
  id: 'voice-generate-tool',
  description: '调用 TTS 语音合成引擎生成角色对白 MP3 音频切片并计算精确时长',
  inputSchema: VoiceGenerateInputSchema,
  outputSchema: VoiceGenerateOutputSchema,
  execute: async (params: any) => {
    try {
      const raw = (params && typeof params === 'object' && 'context' in params && params.context) ? params.context : params;
      const { projectId, segmentId, text, rate = 1.0, emotion, isMock } = raw;

      if (!projectId || !segmentId || !text) {
        return { success: false, error: '缺少必需的 projectId、segmentId 或 text 入参' };
      }

      const res = await VoiceRenderer.renderAudioClip(projectId, segmentId, text, {
        rate,
        emotion,
        isMock,
      });

      return {
        success: true,
        audioUrl: res.audioUrl,
        durationSec: res.durationSec,
      };
    } catch (err: any) {
      console.warn('[voiceGenerateTool] 语音合成异常:', err);
      return { success: false, error: err.message || '语音合成未知异常' };
    }
  },
});
