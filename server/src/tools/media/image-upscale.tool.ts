/**
 * tools/media/image-upscale.tool.ts
 * 图片按需高清超分任务工具 (SeedVR2 Image Upscale Tool SSOT)
 *
 * 统一支持：
 * 1. 定妆资产（character / location / item）：原地升级高清画质并挂载 HD 标识；
 * 2. 分镜关键帧（shot_keyframe 首帧/末帧）：原地高清覆盖落盘并同步回写 film_spec 与 storyboards.json。
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Workflow, createStep } from '@mastra/core/workflows';
import { BaseTaskTool } from '../base/task-tool.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import type { GlobalEntities } from '../../project-store/contracts/film-production/lookdev.js';
import type { FilmAdapterArtifact } from '../../project-store/contracts/film-production/film-spec.js';
import { MediaProviderFactory } from '../../media/providers/MediaProviderFactory.js';
import { MediaDownloader } from '../../media/MediaDownloader.js';
import { atomicWriteJsonSync } from '../../utils/atomicFile.js';
import {
  upgradeFrameVersion,
  newFrameVersionId,
} from '../../project-store/shot-frame-versions.js';
import { getRunContext, isAbortError, throwIfRunAborted } from '../../workflow-engine/run-context.js';

export const ImageUpscaleInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  targetKind: z
    .enum(['character', 'location', 'item', 'shot_keyframe'])
    .describe('目标资产类型：角色/场景/道具定妆或分镜关键帧'),
  targetId: z.string().describe('目标实体 ID（characterId/locationId/itemId）或镜头 ID（shotId）'),
  clipId: z.string().optional().describe('可选所属分幕 ID（shot_keyframe 场景用于加速定位）'),
  frame: z.enum(['first', 'last']).optional().describe('关键帧类型：首帧或末帧（默认 first）'),
  multiplier: z.number().min(1).max(4).optional().describe('超分放大倍率（默认 2，可选 4）'),
  force: z.boolean().optional().describe('是否强制对已超分图片再次执行超分（默认 false）'),
  colorCorrection: z
    .enum(['none', 'lab', 'wavelet', 'adain'])
    .optional()
    .describe('色彩校正模式（官方原版默认 none）'),
});

export type ImageUpscaleInput = z.infer<typeof ImageUpscaleInputSchema>;

export const ImageUpscaleOutputSchema = z.object({
  projectId: z.string(),
  targetKind: z.enum(['character', 'location', 'item', 'shot_keyframe']),
  targetId: z.string(),
  frame: z.enum(['first', 'last']).optional(),
  multiplier: z.number(),
  mediaUrl: z.string(),
  firstFrameImageUrl: z.string().optional(),
  lastFrameImageUrl: z.string().optional(),
  versionId: z.string().optional(),
  success: z.boolean(),
});

export type ImageUpscaleOutput = z.infer<typeof ImageUpscaleOutputSchema>;

const ImageUpscaleStepInputSchema = ImageUpscaleInputSchema.extend({
  _context: z.any().optional(),
});

function cleanUrl(url?: string): string {
  if (!url) return '';
  return url.split('?')[0].trim();
}

const imageUpscaleStep = createStep({
  id: 'upscale-image-seedvr2',
  description: '调用 SeedVR2 工作流对定妆图或分镜关键帧执行高清超分并落盘',
  inputSchema: ImageUpscaleStepInputSchema,
  outputSchema: ImageUpscaleOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as ImageUpscaleInput & { _context?: any };
    const {
      projectId,
      targetKind,
      targetId,
      clipId,
      frame = 'first',
      multiplier = 2,
      colorCorrection = 'none',
    } = input;

    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);
    const reportProgress = input._context?.reportProgress as ((percent: number, note: string) => void) | undefined;

    throwIfRunAborted('ImageUpscaleTool');

    // 1. 解析源图地址
    let sourceImageUrl = '';
    if (targetKind === 'shot_keyframe') {
      const filmSpec = store.getArtifact<FilmAdapterArtifact>(projectId, 'film_spec');
      const clips = filmSpec?.clips || store.getArtifact<any[]>(projectId, 'storyboards') || [];
      let matchedShot: any;
      if (clipId) {
        const c = clips.find((item: any) => item.clipId === clipId || item.sourceNodeId === clipId);
        matchedShot = c?.shots?.find((s: any) => s.shotId === targetId || s.id === targetId);
      }
      if (!matchedShot) {
        for (const c of clips) {
          const found = c?.shots?.find((s: any) => s.shotId === targetId || s.id === targetId);
          if (found) {
            matchedShot = found;
            break;
          }
        }
      }
      if (!matchedShot) {
        throw new Error(`[ImageUpscaleTool] 未在分镜中找到镜头 [${targetId}]`);
      }
      sourceImageUrl = cleanUrl(
        frame === 'last'
          ? matchedShot.lastFrameImageUrl || matchedShot.lastFrameUrl
          : matchedShot.firstFrameImageUrl || matchedShot.keyframeUrl || matchedShot.imageUrl
      );
    } else {
      const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');
      if (!entities) {
        throw new Error(`[ImageUpscaleTool] 项目 [${projectId}] 尚未提取视觉定妆资产`);
      }
      const idKey =
        targetKind === 'character' ? 'characterId' : targetKind === 'location' ? 'locationId' : 'itemId';
      const collection =
        targetKind === 'character'
          ? entities.characters
          : targetKind === 'location'
          ? entities.locations
          : entities.items;
      const entity = (collection || []).find(
        (item: any) => item[idKey] === targetId || item.id === targetId
      );
      if (!entity) {
        throw new Error(`[ImageUpscaleTool] 未在定妆资产中找到 ${targetKind} [${targetId}]`);
      }
      sourceImageUrl = cleanUrl(entity.imageUrl);
    }

    if (!sourceImageUrl) {
      throw new Error(`[ImageUpscaleTool] 目标 [${targetId}] 尚未生成基础图片，无法执行超分`);
    }

    // 2. 调用底层 SeedVR2 超分引擎
    const provider = MediaProviderFactory.getImageProvider();
    if (typeof provider.upscaleImage !== 'function') {
      throw new Error(`[ImageUpscaleTool] 当前图像引擎 [${provider.name}] 不支持高清超分`);
    }

    reportProgress?.(20, `正在使用 SeedVR2 执行 ${multiplier}× 高清超分...`);
    let rawResultUrl = '';
    try {
      rawResultUrl = await provider.upscaleImage(sourceImageUrl, {
        multiplier,
        colorCorrection,
        abortSignal: getRunContext()?.abortSignal || input._context?.abortSignal,
      });
    } catch (err: any) {
      if (isAbortError(err)) throw err;
      throw new Error(`[ImageUpscaleTool] SeedVR2 超分失败: ${err?.message || err}`);
    }

    throwIfRunAborted('ImageUpscaleTool');
    reportProgress?.(80, '高清结果已生成，正在持久化落盘...');

    // 3. 离线落盘并同步回写项目黑板与磁盘 JSON
    if (targetKind === 'shot_keyframe') {
      // 原地升级画质：生成带高清标识的本地文件，原地替换当前生效版本的 imageUrl 并打上 upscale 标记
      const customFilename = `${targetId}-${frame === 'last' ? 'last' : 'first'}-hd_${Date.now()}`;
      const persistentUrl =
        rawResultUrl.startsWith('http://') || rawResultUrl.startsWith('https://')
          ? await MediaDownloader.getInstance().downloadToProject(
              projectId,
              rawResultUrl,
              'keyframes',
              customFilename
            )
          : rawResultUrl;

      const filmSpec = store.getArtifact<FilmAdapterArtifact>(projectId, 'film_spec');
      const clips = filmSpec?.clips || store.getArtifact<any[]>(projectId, 'storyboards') || [];
      const upscaledAt = new Date().toISOString();
      for (const c of clips) {
        const shot = c?.shots?.find((s: any) => s.shotId === targetId || s.id === targetId);
        if (shot) {
          upgradeFrameVersion(shot, frame === 'last' ? 'last' : 'first', {
            imageUrl: persistentUrl,
            upscale: { multiplier, upscaledAt },
          });
          break;
        }
      }
      if (filmSpec) {
        store.setArtifact(projectId, 'film_spec', filmSpec);
      }
      store.setArtifact(projectId, 'storyboards', clips);
      atomicWriteJsonSync(path.join(projectDir, 'storyboards.json'), clips);

      reportProgress?.(100, `高清超分 (${multiplier}×) 完成`);
      return {
        projectId,
        targetKind,
        targetId,
        frame,
        multiplier,
        mediaUrl: persistentUrl,
        ...(frame === 'last'
          ? { lastFrameImageUrl: persistentUrl }
          : { firstFrameImageUrl: persistentUrl }),
        success: true,
      };
    }

    // 定妆资产：原地升级当前版本的画质并挂载高清标记，保持版本数量与创作者意图一致
    const subfolder = targetKind === 'location' ? 'assets/locations' : 'assets/entities';
    const customFilename = `${targetId}-hd_${Date.now()}`;
    const persistentUrl =
      rawResultUrl.startsWith('http://') || rawResultUrl.startsWith('https://')
        ? await MediaDownloader.getInstance().downloadToProject(
            projectId,
            rawResultUrl,
            subfolder,
            customFilename
          )
        : rawResultUrl;

    const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');
    let finalVersionId = '';
    if (entities) {
      const idKey =
        targetKind === 'character' ? 'characterId' : targetKind === 'location' ? 'locationId' : 'itemId';
      const collection =
        targetKind === 'character'
          ? entities.characters
          : targetKind === 'location'
          ? entities.locations
          : entities.items;
      const entity = (collection || []).find(
        (item: any) => item[idKey] === targetId || item.id === targetId
      ) as any;
      if (entity) {
        entity.versions ||= [];
        const upscaledAt = new Date().toISOString();
        const targetVersion =
          entity.versions.find((v: any) => v.versionId === entity.selectedVersionId) ||
          entity.versions[entity.versions.length - 1];

        if (targetVersion) {
          targetVersion.imageUrl = persistentUrl;
          targetVersion.upscale = { multiplier, upscaledAt };
          entity.imageUrl = persistentUrl;
          finalVersionId = targetVersion.versionId;
        } else {
          finalVersionId = newFrameVersionId();
          entity.versions.push({
            versionId: finalVersionId,
            imageUrl: persistentUrl,
            promptZh: entity.promptZh || '',
            referenceImageUrl: entity.referenceImageUrl,
            instruction: `SeedVR2 高清超分 (${multiplier}×)`,
            upscale: { multiplier, upscaledAt },
            createdAt: upscaledAt,
          });
          entity.imageUrl = persistentUrl;
          entity.selectedVersionId = finalVersionId;
        }

        store.setArtifact(projectId, 'lookdev_entities', entities);
        const scenesDir = path.join(projectDir, 'scenes');
        fs.mkdirSync(scenesDir, { recursive: true });
        atomicWriteJsonSync(path.join(scenesDir, 'entities.json'), entities);
      }
    }

    reportProgress?.(100, `高清超分 (${multiplier}×) 完成`);
    return {
      projectId,
      targetKind,
      targetId,
      multiplier,
      mediaUrl: persistentUrl,
      versionId: finalVersionId,
      success: true,
    };
  },
});

export function createImageUpscaleWorkflow() {
  return new Workflow({
    name: 'image-upscale-workflow',
    triggerSchema: ImageUpscaleStepInputSchema,
  })
    .step(imageUpscaleStep)
    .commit();
}

export class ImageUpscaleTool extends BaseTaskTool<ImageUpscaleInput, ImageUpscaleOutput> {
  public readonly toolName = 'film.image_upscale';
  public readonly description = '调用 SeedVR2 工作流对已有定妆图或分镜关键帧执行按需高清超分';
  public readonly inputSchema = ImageUpscaleInputSchema;
  public readonly outputSchema = ImageUpscaleOutputSchema;

  public override resolveConcurrencyKey(projectId: string, input?: Record<string, any>): string | null {
    const targetId = typeof input?.targetId === 'string' ? input.targetId.trim() : '';
    if (!targetId) return null;
    const kind = typeof input?.targetKind === 'string' ? input.targetKind.trim() : 'entity';
    return `${projectId}:${kind}:${targetId}`;
  }

  protected buildWorkflow() {
    return createImageUpscaleWorkflow();
  }
}

export const imageUpscaleTool = new ImageUpscaleTool();
