/**
 * tools/video-generate/video-generate.tool.ts
 * 纯物理图生视频算力原子工具 (Pure Tool SSOT)
 */

import { createTool } from '../../mastra-compat/index.js';
import { z } from 'zod';
import { MediaProviderFactory } from '../../media/providers/MediaProviderFactory.js';
import { MediaDownloader } from '../../media/MediaDownloader.js';

export const VIDEO_GENERATE_TOOL_ID = 'generate_video';

export const VideoGenerateInputSchema = z.object({
  projectId: z.string().describe('所属项目 ID，用于媒体资产本地沙箱持久化落盘'),
  prompt: z.string().describe('专业影视分镜与运镜视频提示词'),
  referenceImageUrl: z.string().optional().describe('首帧参考图 URL 或 /media/... 本地路径'),
  duration: z.number().optional().describe('视频生成时长（秒），默认 5'),
  subfolder: z.string().optional().describe('存储子目录，默认 video'),
  customFilename: z.string().optional().describe('自定义文件名'),
});

export const videoGenerateTool = createTool({
  id: VIDEO_GENERATE_TOOL_ID,
  description: '调用底座真实视频算力引擎（ComfyUI MiniMax-H3 工作流），生成高质量分镜视频并安全落盘至本地持久化工程目录。',
  inputSchema: VideoGenerateInputSchema,
  execute: async ({ context }) => {
    const {
      projectId,
      prompt,
      referenceImageUrl,
      duration = 5,
      subfolder = 'video',
      customFilename,
    } = context;

    const provider = MediaProviderFactory.getVideoProvider();
    const rawResultUrl = await provider.generateVideo(prompt, {
      referenceImageUrl,
      duration,
    });

    let persistentUrl = rawResultUrl;

    if (rawResultUrl.startsWith('http://') || rawResultUrl.startsWith('https://')) {
      persistentUrl = await MediaDownloader.getInstance().downloadToProject(
        projectId,
        rawResultUrl,
        subfolder,
        customFilename
      );
    }

    return {
      success: true,
      videoUrl: persistentUrl,
      rawUrl: rawResultUrl,
      projectId,
    };
  },
});
