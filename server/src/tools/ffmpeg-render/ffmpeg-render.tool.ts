/**
 * tools/ffmpeg-render/ffmpeg-render.tool.ts
 * 真实物理算力：本地音视频处理与剪辑总装工具 (FFmpeg Render Tool SSOT)
 * 供全剧组 (PipelineAgent / ModifierAgent / Workflow Steps) 公共调度
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { FFmpegService } from '../../media/index.js';

export const FFmpegRenderInputSchema = z.object({
  action: z.enum(['concat', 'extract_frame', 'transcode', 'create_test_clip']).describe('FFmpeg 物理处理动作类型'),
  inputPaths: z.array(z.string()).optional().describe('输入文件路径列表 (如待拼接的视频切片)'),
  outputPath: z.string().describe('输出目标文件的绝对路径'),
  timeSec: z.number().optional().describe('截取/抽帧的时间点 (秒)'),
  durationSec: z.number().optional().describe('合成测试片段的时长 (秒)'),
  textOverlay: z.string().optional().describe('文字水印或测试内容'),
});

export const FFmpegRenderOutputSchema = z.object({
  success: z.boolean(),
  outputPath: z.string(),
  error: z.string().optional(),
});

export const ffmpegRenderTool = createTool({
  id: 'ffmpeg-render-tool',
  description: '调用本地 FFmpeg 原生能力执行多镜头拼接、抽帧、视频转码或占位切片生成',
  inputSchema: FFmpegRenderInputSchema,
  outputSchema: FFmpegRenderOutputSchema,
  execute: async (params: any) => {
    try {
      const raw = (params && typeof params === 'object' && 'context' in params && params.context) ? params.context : params;
      const { action, inputPaths, outputPath, timeSec = 0, durationSec = 1, textOverlay = 'makeMv clip' } = raw;
      const ffmpeg = new FFmpegService();

      switch (action) {
        case 'concat': {
          if (!inputPaths || inputPaths.length === 0) {
            return { success: false, outputPath, error: '拼接视频必须提供 inputPaths' };
          }
          await ffmpeg.concatClips(inputPaths, outputPath);
          break;
        }
        case 'extract_frame': {
          if (!inputPaths || inputPaths.length === 0) {
            return { success: false, outputPath, error: '抽帧必须提供 inputPaths[0]' };
          }
          await ffmpeg.extractFrame(inputPaths[0], timeSec, outputPath);
          break;
        }
        case 'create_test_clip': {
          await ffmpeg.createTestClip({
            duration: durationSec,
            text: textOverlay,
            outputPath,
          });
          break;
        }
        default:
          return { success: false, outputPath, error: `不支持的动作类型: ${action}` };
      }

      return { success: true, outputPath };
    } catch (err: any) {
      console.warn('[ffmpegRenderTool] FFmpeg 处理异常:', err);
      return { success: false, outputPath: '', error: err.message || 'FFmpeg 执行未知异常' };
    }
  },
});
