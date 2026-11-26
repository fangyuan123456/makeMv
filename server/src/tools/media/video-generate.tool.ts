/**
 * tools/media/video-generate.tool.ts
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
  audioPrompt: z.string().optional().describe('与视频同步生成的音效、环境声、音乐氛围与对白表现提示词'),
  mode: z.enum(['ref2v']).optional().describe('视频生成模式：ref2v（多图全能参考直出）'),
  referenceImageUrl: z.string().optional().describe('单张参考图 URL 或 /media/... 本地路径（当未传 referenceImageUrls 时作为参考图）'),
  referenceImageUrls: z.array(z.string()).optional().describe('多图全能参考直出时的参考图列表（按顺序映射为 <Picture 1>, <Picture 2>...）'),
  lastFrameImageUrl: z.string().optional().describe('尾帧参考图 URL 或 /media/... 本地路径'),
  duration: z.number().optional().describe('视频生成时长（秒，支持 2~15 秒），默认 5'),
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
      audioPrompt,
      mode,
      referenceImageUrl,
      referenceImageUrls,
      lastFrameImageUrl,
      duration = 5,
      subfolder = 'video',
      customFilename,
    } = context;

    const provider = MediaProviderFactory.getVideoProvider();
    const combinedPrompt = audioPrompt ? `${prompt}\nAudio: ${audioPrompt}` : prompt;
    const rawResultUrl = await provider.generateVideo(combinedPrompt, {
      mode,
      referenceImageUrl,
      referenceImageUrls,
      lastFrameImageUrl,
      duration,
      audioPrompt,
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
