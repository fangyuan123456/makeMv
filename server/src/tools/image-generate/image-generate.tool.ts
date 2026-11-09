/**
 * tools/image-generate/image-generate.tool.ts
 * 纯物理生图算力原子工具 (Pure Tool SSOT)
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { MediaProviderFactory } from '../../media/providers/MediaProviderFactory.js';
import { MediaDownloader } from '../../media/MediaDownloader.js';
import { MediaResolver } from '../../media/MediaResolver.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';

export const IMAGE_GENERATE_TOOL_ID = 'generate_image';

export const ImageGenerateInputSchema = z.object({
  projectId: z.string().describe('所属项目 ID，用于媒体资产本地沙箱持久化落盘'),
  prompt: z.string().describe('专业影视生图提示词（中文或英文，包含构图、光影、主体特征）'),
  referenceImageUrl: z.string().optional().describe('可选参考图 URL 或 /media/... 本地路径'),
  mode: z
    .enum(['character_t2i', 'character_ref2i', 'character_pose_outfit', 'character_three_view', 'general_t2i'])
    .optional()
    .describe('生图模式'),
  size: z.string().optional().default('1280*720').describe('画幅尺寸，如 1280*720, 1024*1024, 720*1280'),
  subfolder: z.string().optional().default('keyframes').describe('存储子目录，如 keyframes, characters, scenes'),
  customFilename: z.string().optional().describe('自定义文件名'),
});

export const imageGenerateTool = createTool({
  id: IMAGE_GENERATE_TOOL_ID,
  description: '调用底座真实文生图算力引擎（ComfyUI 工作流 / Mock），生成高质量画面并安全落盘至本地持久化工程目录。',
  inputSchema: ImageGenerateInputSchema,
  execute: async ({ context }) => {
    const { projectId, prompt, referenceImageUrl, mode, size, subfolder, customFilename } = context;

    const provider = MediaProviderFactory.getImageProvider();
    const rawResultUrl = await provider.generateImage(prompt, {
      size,
      referenceImageUrl,
      mode,
    });

    let persistentUrl = rawResultUrl;

    // 1. 若为远程 HTTP/HTTPS URL，使用 MediaDownloader 离线持久化落盘
    if (rawResultUrl.startsWith('http://') || rawResultUrl.startsWith('https://')) {
      persistentUrl = await MediaDownloader.getInstance().downloadToProject(
        projectId,
        rawResultUrl,
        subfolder,
        customFilename
      );
    } else if (rawResultUrl.startsWith('data:')) {
      // 2. 若为 Data URI (如 Mock 生成的 SVG 或 Base64)，写入磁盘
      const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
      const targetDir = path.resolve(projectDir, subfolder || 'media');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const isSvg = rawResultUrl.startsWith('data:image/svg+xml');
      const ext = isSvg ? '.svg' : '.png';
      const filename = customFilename ? (customFilename.endsWith(ext) ? customFilename : `${customFilename}${ext}`) : `img_${Date.now()}${ext}`;
      const diskPath = path.resolve(targetDir, filename);

      const base64Data = rawResultUrl.replace(/^data:[^;]+;base64,/, '');
      fs.writeFileSync(diskPath, Buffer.from(base64Data, 'base64'));

      persistentUrl = MediaResolver.toMediaUrl(projectId, subfolder || 'media', filename);
    }

    const diskResolved = MediaResolver.resolveDiskPath(persistentUrl);

    return {
      success: true,
      mediaUrl: persistentUrl,
      diskPath: diskResolved.diskPath,
      provider: provider.name,
      message: `图像生成并持久化成功: ${persistentUrl}`,
    };
  },
});
