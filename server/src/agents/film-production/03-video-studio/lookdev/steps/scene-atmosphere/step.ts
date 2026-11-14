/**
 * agents/film-production/03-video-studio/lookdev/steps/scene-atmosphere/step.ts
 * 场景无人空镜执行器与原子 Step
 */

import { createStep } from '@mastra/core/workflows';
import path from 'node:path';
import fs from 'node:fs';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { MediaResolver } from '../../../../../../media/MediaResolver.js';
import { imageGenerateTool } from '../../../../../../tools/image-generate/image-generate.tool.js';
import { isAbortError } from '../../../../../../workflow-engine/run-context.js';
import type { GlobalEntities } from '../../../../../../project-store/contracts/film-production/lookdev.js';

const LOCATION_SUBFOLDER = 'assets/locations';
import {
  SceneAtmosphereInputSchema,
  SceneAtmosphereOutputSchema,
  type SceneAtmosphereInput,
  type SceneAtmosphereOutput,
} from './schema.js';
import {
  buildSceneAtmospherePrompt,
  SCENE_ATMOSPHERE_SIZE,
  SCENE_ATMOSPHERE_NEGATIVE,
} from './prompt.js';

export async function renderSceneAtmosphere(
  input: SceneAtmosphereInput
): Promise<SceneAtmosphereOutput> {
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
    throw new Error(`[SceneAtmosphere] 项目 [${projectId}] 尚未提取视觉资产`);
  }

  const loc = entities.locations.find((l: any) => l.locationId === locationId);
  if (!loc) {
    throw new Error(`[SceneAtmosphere] 未找到场景 [${locationId}]`);
  }

  // 若用户手动调整了提示词，持久化回写至场景设定
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

  // 1. 检查磁盘已有同名资产缓存 (若带 customPrompt 或显式 force，则跳过缓存直接重做)
  const isCustomRedo = Boolean(customPrompt || referenceImageUrls?.length);
  const existingFiles = fs.readdirSync(targetDir);
  const cachedFile = existingFiles.find((f) => f.startsWith(`${locationId}.`));
  const cachedUrl = cachedFile
    ? MediaResolver.toMediaUrl(projectId, LOCATION_SUBFOLDER, cachedFile)
    : undefined;

  if (cachedUrl && !force && !isCustomRedo) {
    loc.referenceImageUrl = cachedUrl;
    store.setArtifact(projectId, 'lookdev_entities', entities);
    return {
      projectId,
      locationId,
      imageUrl: cachedUrl,
      diskPath: `${LOCATION_SUBFOLDER}/${cachedFile}`,
      reused: true,
      success: true,
    };
  }

  // 2. 调用物理文生图工具出图 (支持垫参考图)
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

    if (res?.success && res?.mediaUrl) {
      loc.referenceImageUrl = res.mediaUrl;
      store.setArtifact(projectId, 'lookdev_entities', entities);
      const relPath = res.diskPath
        ? path.relative(projectDir, res.diskPath).split(path.sep).join('/')
        : undefined;
      return {
        projectId,
        locationId,
        imageUrl: res.mediaUrl,
        diskPath: relPath,
        reused: false,
        success: true,
      };
    }
  } catch (err: any) {
    if (isAbortError(err)) throw err;
    console.warn(`[SceneAtmosphere] 场景 [${locationId}] 空镜出图异常:`, err);
  }

  return {
    projectId,
    locationId,
    imageUrl: cachedUrl,
    reused: false,
    success: Boolean(cachedUrl),
  };
}

export const sceneAtmosphereStep = createStep({
  id: 'step_lookdev_scene_atmosphere',
  description: '场景无人广角空镜定妆工序 (1280*720 纯空间与光影)',
  inputSchema: SceneAtmosphereInputSchema,
  outputSchema: SceneAtmosphereOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx;
    return await renderSceneAtmosphere(input);
  },
});
