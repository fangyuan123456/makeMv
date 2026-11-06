/**
 * tools/image-inpaint/image-inpaint.tool.ts
 * 真实物理算力：图像局部重绘与换姿换装工具 (Image Inpaint Tool SSOT)
 * 供全剧组 (ModifierAgent / Workflow Steps) 公共调度
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CharacterRenderer } from '../../media/index.js';

export const ImageInpaintInputSchema = z.object({
  projectId: z.string().describe('项目全局唯一 ID'),
  characterName: z.string().describe('被修改的角色名称'),
  prompt: z.string().describe('局部重绘/换姿换装提示词'),
  sourceImageUrl: z.string().describe('待修改的原始基准图片 URL'),
  outfitImageUrl: z.string().optional().describe('服饰参考图 URL (若有)'),
  isMock: z.boolean().optional().describe('是否处于 Mock 预演测试模式'),
});

export const ImageInpaintOutputSchema = z.object({
  success: z.boolean(),
  url: z.string().optional().describe('局部重绘后新图片本地 URL'),
  isDegraded: z.boolean().optional(),
  degradedReason: z.string().optional(),
  error: z.string().optional(),
});

export const imageInpaintTool = createTool({
  id: 'image-inpaint-tool',
  description: '调用 GPU 局部重绘算力 (ComfyUI Inpaint) 对角色进行换发型、换衣服或姿势动作定向微调',
  inputSchema: ImageInpaintInputSchema,
  outputSchema: ImageInpaintOutputSchema,
  execute: async (params: any) => {
    try {
      const raw = (params && typeof params === 'object' && 'context' in params && params.context) ? params.context : params;
      const { projectId, characterName, prompt, sourceImageUrl, outfitImageUrl, isMock } = raw;

      if (!projectId || !characterName || !sourceImageUrl || !prompt) {
        return { success: false, error: '缺少必需的 projectId、characterName、sourceImageUrl 或 prompt 入参' };
      }

      const res = await CharacterRenderer.renderCharacterPoseOutfit(
        projectId,
        characterName,
        prompt,
        sourceImageUrl,
        outfitImageUrl,
        { isMock }
      );

      return {
        success: true,
        url: res.url,
        isDegraded: res.isDegraded,
        degradedReason: res.degradedReason,
      };
    } catch (err: any) {
      console.warn('[imageInpaintTool] 局部重绘异常:', err);
      return { success: false, error: err.message || '局部重绘未知异常' };
    }
  },
});
