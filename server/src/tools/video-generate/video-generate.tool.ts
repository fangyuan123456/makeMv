/**
 * tools/video-generate/video-generate.tool.ts
 * 真实物理算力：动态视频镜头切片渲染工具 (Video Generate Tool SSOT)
 * 供全剧组 (PipelineAgent / ModifierAgent / Workflow Steps) 公共调度
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { VideoRenderer } from '../../media/index.js';

export const VideoGenerateInputSchema = z.object({
  projectId: z.string().describe('项目全局唯一 ID'),
  shotId: z.string().describe('分镜镜头唯一标识 (如 shot_1)'),
  clipId: z.string().optional().describe('视频切片 ID (若未传自动生成)'),
  prompt: z.string().describe('动态镜头运镜与动态效果提示词'),
  referenceImageUrl: z.string().optional().describe('首帧关键帧图片 URL (图生视频源图)'),
  durationSec: z.number().default(3).describe('视频镜头时长 (秒)'),
  resolution: z.string().default('720P').describe('渲染分辨率 (720P / 1080P)'),
  aspectRatio: z.string().default('16:9').describe('画面比例 (16:9 / 9:16)'),
  isMock: z.boolean().optional().describe('是否处于 Mock 预演测试模式'),
});

export const VideoGenerateOutputSchema = z.object({
  success: z.boolean(),
  url: z.string().optional().describe('渲染完成的动态视频切片本地 URL'),
  isDegraded: z.boolean().optional(),
  degradedReason: z.string().optional(),
  error: z.string().optional(),
});

export const videoGenerateTool = createTool({
  id: 'video-generate-tool',
  description: '调用底层生视频大模型 (Wanx-I2V / ComfyUI) 将静态首帧转换为高清动态视频切片',
  inputSchema: VideoGenerateInputSchema,
  outputSchema: VideoGenerateOutputSchema,
  execute: async (params: any) => {
    try {
      const raw = (params && typeof params === 'object' && 'context' in params && params.context) ? params.context : params;
      const {
        projectId,
        shotId,
        clipId = `clip_${shotId}_${Date.now()}`,
        prompt,
        referenceImageUrl,
        durationSec = 3,
        resolution = '720P',
        aspectRatio = '16:9',
        isMock,
      } = raw;

      if (!projectId || !shotId || !prompt) {
        return { success: false, error: '缺少必需的 projectId、shotId 或 prompt 入参' };
      }

      const res = await VideoRenderer.renderVideoClip(
        projectId,
        clipId,
        shotId,
        durationSec,
        resolution,
        aspectRatio,
        prompt,
        referenceImageUrl,
        { isMock }
      );

      return {
        success: true,
        url: res.url,
        isDegraded: res.isDegraded,
        degradedReason: res.degradedReason,
      };
    } catch (err: any) {
      console.warn('[videoGenerateTool] 视频渲染异常:', err);
      return { success: false, error: err.message || '视频渲染未知异常' };
    }
  },
});
