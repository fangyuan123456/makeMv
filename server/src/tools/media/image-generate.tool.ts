/**
 * tools/media/image-generate.tool.ts
 * 纯物理生图算力原子工具 (Pure Tool SSOT)
 */

import { createTool } from '../../mastra-compat/index.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { MediaProviderFactory } from '../../media/providers/MediaProviderFactory.js';
import { MediaDownloader } from '../../media/MediaDownloader.js';
import { MediaResolver } from '../../media/MediaResolver.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { config } from '../../utils/config.js';
import { getRunContext, throwIfRunAborted } from '../../workflow-engine/run-context.js';
import { compileMediaPrompt } from '../../media/compiler/media-semantic-compiler.js';

export const IMAGE_GENERATE_TOOL_ID = 'generate_image';

export const ImageGenerateInputSchema = z.object({
  projectId: z.string().describe('所属项目 ID，用于媒体资产本地沙箱持久化落盘'),
  prompt: z.string().describe('纯自然语言电影生图文学描述（无 @ 符号，内部全自动编译对齐资产）'),
  entities: z.any().optional().describe('项目资产库（包含 characters, locations, items 及其定妆图）'),
  precedingFrameUrl: z.string().optional().describe('可选前序镜头接戏末帧图片 URL/路径'),
  precedingFrameName: z.string().optional().describe('可选前序镜头名称'),
  customReferenceUrls: z.array(z.string()).optional().describe('可选创作者手动指定的垫图参考列表'),
  baseFrameUrl: z.string().optional().describe('可选微调重绘基准图路径'),
  instruction: z.string().optional().describe('可选画面局部微调指令'),
  poseDirective: z.any().optional().describe('可选角色动作姿态硬约束，用于底层物理动作防穿帮'),
  negativePrompt: z.string().optional().describe('可选负向提示词，默认使用电影级防畸变负向提示词'),
  referenceImageUrls: z
    .array(z.string())
    .optional()
    .describe('兼容历史显式传入的参考图 URL 列表'),
  mode: z
    .enum([
      'character_t2i',
      'character_ref2i',
      'character_pose_outfit',
      'character_three_view',
      'scene_ref2i',
      'general_t2i',
    ])
    .optional()
    .describe('生图模式（若未提供，内部根据语义解析资产图全自动决断）'),
  size: z
    .string()
    .optional()
    .describe(`画幅尺寸（宽*高），如 ${config.frame.imageSize}、1024*1024；默认跟随全剧画幅配置 GAME_FRAME_ASPECT`),
  denoise: z
    .number()
    .min(0.01)
    .max(1.0)
    .optional()
    .describe('采样器去噪强度（微调修改通常 0.45~0.60，全量重构 1.0）'),
  maskImageUrl: z.string().optional().describe('可选局部重绘遮罩蒙版图片路径'),
  subfolder: z.string().optional().describe('存储子目录，如 keyframes, characters, scenes，默认 keyframes'),
  customFilename: z.string().optional().describe('自定义文件名'),
});

export const imageGenerateTool = createTool({
  id: IMAGE_GENERATE_TOOL_ID,
  description: '调用底座真实文生图算力引擎（ComfyUI 工作流 / Mock），自动编译纯自然语言与资产库多图映射，生成高质量画面并安全落盘至本地持久化工程目录。',
  inputSchema: ImageGenerateInputSchema,
  execute: async ({ context }) => {
    const {
      projectId,
      prompt,
      entities,
      precedingFrameUrl,
      precedingFrameName,
      customReferenceUrls,
      baseFrameUrl,
      instruction,
      negativePrompt,
      referenceImageUrls,
      mode: explicitMode,
      denoise,
      maskImageUrl,
      size = config.frame.imageSize,
      subfolder = 'keyframes',
      customFilename,
    } = context;

    throwIfRunAborted('ImageGenerateTool');

    // 内部通用媒体语义编译：将纯自然语言 + 资产库编译为硬件级多图注意力提示词与参考图队列
    const compiled = compileMediaPrompt({
      text: prompt,
      entities,
      precedingFrameUrl,
      precedingFrameName,
      customReferenceUrls: customReferenceUrls || referenceImageUrls,
      baseFrameUrl,
      instruction,
      poseDirective: (context as any).poseDirective,
      overrideNegativePrompt: negativePrompt,
    });

    const finalPrompt = compiled.compiledPrompt;
    const finalNegativePrompt = compiled.negativePrompt;
    const finalRefUrls = compiled.referenceImageUrls;
    const finalMode = explicitMode || compiled.mode;

    const provider = MediaProviderFactory.getImageProvider();
    const rawResultUrl = await provider.generateImage(finalPrompt, {
      size,
      negativePrompt: finalNegativePrompt,
      referenceImageUrls: finalRefUrls.length > 0 ? finalRefUrls : undefined,
      mode: finalMode,
      denoise,
      maskImageUrl,
      abortSignal: getRunContext()?.abortSignal,
    });
    throwIfRunAborted('ImageGenerateTool');

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
      const knownImageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
      let cleanCustom: string | undefined;
      if (customFilename) {
        const sanitizedBase = path
          .basename(customFilename.trim())
          .replace(/[^a-zA-Z0-9_\-\.]/g, '_')
          .replace(/\.{2,}/g, '_')
          .replace(/\.+$/, '');
        const existingExt = path.extname(sanitizedBase).toLowerCase();
        const stem = knownImageExts.has(existingExt)
          ? sanitizedBase.slice(0, sanitizedBase.length - existingExt.length)
          : sanitizedBase;
        if (stem && !/^[\._\-]+$/.test(stem)) {
          cleanCustom = stem;
        }
      }
      const filename = `${cleanCustom || `img_${Date.now()}`}${ext}`;
      const diskPath = path.resolve(targetDir, filename);
      if (!diskPath.startsWith(path.resolve(targetDir) + path.sep)) {
        throw new Error(`[ImageGenerateTool] 非法文件名路径穿越: "${customFilename}"`);
      }

      const base64Data = rawResultUrl.replace(/^data:[^;]+;base64,/, '');
      fs.writeFileSync(diskPath, Buffer.from(base64Data, 'base64'));

      persistentUrl = MediaResolver.toMediaUrl(projectId, subfolder || 'media', filename);
    }

    const diskResolved = MediaResolver.resolveDiskPath(persistentUrl);

    return {
      success: true,
      mediaUrl: persistentUrl,
      imageUrl: persistentUrl,
      compiledPrompt: finalPrompt,
      diskPath: diskResolved.diskPath,
      provider: provider.name,
      message: `图像生成并持久化成功: ${persistentUrl}`,
    };
  },
});
