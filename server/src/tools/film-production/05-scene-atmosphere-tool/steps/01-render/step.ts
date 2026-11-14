/**
 * tools/film-production/05-scene-atmosphere-tool/steps/01-render/step.ts
 * 场景空镜物理渲染工序执行器 (sceneAtmosphereStep)
 */

import { createStep } from '@mastra/core/workflows';
import path from 'node:path';
import fs from 'node:fs';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { MediaResolver } from '../../../../../media/MediaResolver.js';
import { imageGenerateTool } from '../../../../image-generate/image-generate.tool.js';
import { isAbortError } from '../../../../../workflow-engine/run-context.js';
import type { GlobalEntities } from '../../../../../project-store/contracts/film-production/lookdev.js';
import {
  SceneAtmosphereStepInputSchema,
  SceneAtmosphereStepOutputSchema,
  type SceneAtmosphereStepInput,
  type SceneAtmosphereStepOutput,
} from './schema.js';
import {
  buildSceneAtmospherePrompt,
  SCENE_ATMOSPHERE_SIZE,
  SCENE_ATMOSPHERE_NEGATIVE,
} from './prompt.js';

const LOCATION_SUBFOLDER = 'assets/locations';

export const sceneAtmosphereStep = createStep({
  id: 'render-scene-atmosphere',
  description: '调用物理生图算力与垫参考图，渲染单个场景无人高清广角空镜母本图并落盘',
  inputSchema: SceneAtmosphereStepInputSchema,
  outputSchema: SceneAtmosphereStepOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as SceneAtmosphereStepInput;
    const {
      projectId,
      locationId,
      force = false,
      customPrompt,
      customNegativePrompt,
      referenceImageUrls,
    } = input;

    const store = ProjectStore.getInstance();
    const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');

    if (!entities) {
      throw new Error(`[SceneAtmosphereTool] 项目 [${projectId}] 尚未提取视觉资产 lookdev_entities`);
    }

    const loc = entities.locations?.find((l: any) => l.locationId === locationId);
    if (!loc) {
      throw new Error(`[SceneAtmosphereTool] 未在视觉资产中找到场景 [${locationId}]`);
    }

    if (customPrompt && customPrompt.trim()) {
      loc.promptZh = customPrompt.trim();
    }

    const artStyle = entities.artStyle || '电影级写实光影质感，细节丰富，自然色彩影调';
    const prompt = customPrompt && customPrompt.trim()
      ? customPrompt.trim()
      : buildSceneAtmospherePrompt(loc, artStyle);
    const negativePrompt = customNegativePrompt || SCENE_ATMOSPHERE_NEGATIVE;

    const projectDir = store.getProjectDir(projectId);
    const targetDir = path.resolve(projectDir, LOCATION_SUBFOLDER);
    fs.mkdirSync(targetDir, { recursive: true });

    // 检查缓存
    const isCustomRedo = Boolean(customPrompt || referenceImageUrls?.length);
    const existingFiles = fs.readdirSync(targetDir);
    const cachedFile = existingFiles.find((f) => f.startsWith(`${locationId}.`));
    const cachedUrl = cachedFile
      ? MediaResolver.toMediaUrl(projectId, LOCATION_SUBFOLDER, cachedFile)
      : undefined;

    if (cachedFile && cachedUrl && !force && !isCustomRedo) {
      loc.referenceImageUrl = cachedUrl;
      store.setArtifact(projectId, 'lookdev_entities', entities);
      return {
        projectId,
        locationId,
        imageUrl: cachedUrl,
        diskPath: path.resolve(targetDir, cachedFile),
        reused: true,
        success: true,
      };
    }

    // 物理调用生图
    try {
      const res = await (imageGenerateTool.execute as any)({
        context: {
          projectId,
          prompt,
          negativePrompt,
          referenceImageUrls: referenceImageUrls && referenceImageUrls.length ? referenceImageUrls : undefined,
          mode: 'general_t2i',
          size: SCENE_ATMOSPHERE_SIZE,
          subfolder: LOCATION_SUBFOLDER,
          customFilename: locationId,
        },
      });

      const mediaUrl = res?.mediaUrl || res?.imageUrl;
      if (!res?.success || !mediaUrl) {
        throw new Error(res?.error || '场景空镜渲染失败：未返回有效图片地址');
      }

      loc.referenceImageUrl = mediaUrl;
      store.setArtifact(projectId, 'lookdev_entities', entities);

      return {
        projectId,
        locationId,
        imageUrl: mediaUrl,
        diskPath: res.diskPath,
        reused: false,
        success: true,
      };
    } catch (err: any) {
      if (isAbortError(err)) throw err;
      throw new Error(`[SceneAtmosphereTool] 场景 [${locationId}] 渲染失败: ${err?.message || err}`);
    }
  },
});
