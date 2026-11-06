/**
 * tools/image-generate/image-generate.tool.ts
 * 真实物理算力：文生图与概念立绘渲染工具 (Image Generate Tool SSOT)
 * 供全剧组 (PipelineAgent / ModifierAgent / Workflow Steps) 公共调度
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CharacterRenderer, KeyframeRenderer } from '../../media/index.js';

export const ImageGenerateInputSchema = z.object({
  projectId: z.string().describe('项目全局唯一 ID'),
  prompt: z.string().describe('生图正向提示词'),
  characterName: z.string().optional().describe('若针对特定角色生成立绘，填入角色名'),
  shotId: z.string().optional().describe('若针对特定分镜生成关键帧首帧，填入镜头号 (如 shot_1)'),
  aspectRatio: z.string().default('16:9').describe('画面比例 (如 16:9 / 9:16)'),
  resolution: z.string().default('720P').describe('渲染分辨率 (如 720P / 1080P)'),
  referenceImageUrl: z.string().optional().describe('垫图/视觉参考图 URL'),
  isMock: z.boolean().optional().describe('是否处于 Mock 预演测试模式'),
});

export const ImageGenerateOutputSchema = z.object({
  success: z.boolean(),
  url: z.string().optional().describe('生成的图片永久本地/云端 URL'),
  isDegraded: z.boolean().optional(),
  degradedReason: z.string().optional(),
  error: z.string().optional(),
});

export const imageGenerateTool = createTool({
  id: 'image-generate-tool',
  description: '调用 GPU 算力 (ComfyUI / 真实文生图模型) 渲染角色立绘或分镜视觉基准图',
  inputSchema: ImageGenerateInputSchema,
  outputSchema: ImageGenerateOutputSchema,
  execute: async (params: any) => {
    try {
      const raw = (params && typeof params === 'object' && 'context' in params && params.context) ? params.context : params;
      const { projectId, prompt, characterName, shotId, aspectRatio = '16:9', referenceImageUrl, isMock } = raw;

      if (!projectId || !prompt) {
        return { success: false, error: '缺少必需的 projectId 或 prompt 入参' };
      }

      // 1. 若指定了 characterName，调度 CharacterRenderer 产出角色定妆立绘
      if (characterName) {
        const res = await CharacterRenderer.renderCharacterPortrait(
          projectId,
          characterName,
          prompt,
          { isMock, referenceImageUrl }
        );
        return {
          success: true,
          url: res.url,
          isDegraded: res.isDegraded,
          degradedReason: res.degradedReason,
        };
      }

      // 2. 默认或分镜模式：调度 KeyframeRenderer 产出分镜首帧图
      const effectiveShotId = shotId || `frame_${Date.now()}`;
      const res = await KeyframeRenderer.renderKeyframeImage(
        projectId,
        effectiveShotId,
        aspectRatio,
        prompt,
        { isMock }
      );

      return {
        success: true,
        url: res.url,
        isDegraded: res.isDegraded,
        degradedReason: res.degradedReason,
      };
    } catch (err: any) {
      console.warn('[imageGenerateTool] 图像渲染异常:', err);
      return { success: false, error: err.message || '图像渲染未知异常' };
    }
  },
});
