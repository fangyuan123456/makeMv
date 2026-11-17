/**
 * tools/film-production/05-scene-atmosphere-tool/steps/01-render/step.ts
 * 场景空镜物理渲染工序执行器 (sceneAtmosphereStep)
 */

import { createStep } from '@mastra/core/workflows';
import path from 'node:path';
import fs from 'node:fs';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { atomicWriteJsonSync } from '../../../../../utils/atomicFile.js';
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
      instruction,
      customPrompt,
      customNegativePrompt,
      referenceImageUrls,
    } = input;

    const store = ProjectStore.getInstance();
    const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');

    if (!entities) {
      throw new Error(`[SceneAtmosphereTool] 项目 [${projectId}] 尚未提取视觉资产 lookdev_entities`);
    }

    const renderSingleLoc = async (loc: any) => {
      if (customPrompt && customPrompt.trim()) {
        loc.promptZh = customPrompt.trim();
      }

      const artStyle = entities.artStyle || '电影级写实光影质感，细节丰富，自然色彩影调';
      // 提取垫图（优先显式传入，其次为实体已绑定的 referenceImageUrl）
      const effectiveRefUrls =
        referenceImageUrls && referenceImageUrls.length
          ? referenceImageUrls
          : loc.referenceImageUrl
          ? [loc.referenceImageUrl]
          : undefined;

      const prompt = customPrompt && customPrompt.trim()
        ? customPrompt.trim()
        : buildSceneAtmospherePrompt(loc, artStyle, Boolean(effectiveRefUrls?.length));
      const negativePrompt = customNegativePrompt
        ? `${customNegativePrompt}，${SCENE_ATMOSPHERE_NEGATIVE}`
        : SCENE_ATMOSPHERE_NEGATIVE;

      const projectDir = store.getProjectDir(projectId);
      const targetDir = path.resolve(projectDir, LOCATION_SUBFOLDER);
      fs.mkdirSync(targetDir, { recursive: true });

      const isCustomRedo = Boolean(customPrompt || referenceImageUrls?.length);

      // 若已有场景氛围且未要求强制重新生成，坚决不动已定妆场景
      if (loc.imageUrl && !force && !isCustomRedo) {
        console.log(`[SceneAtmosphereTool] 场景 [${loc.locationId}] 已有定妆资产，保留不重新生成: ${loc.imageUrl}`);
        return loc.imageUrl;
      }

      const existingFiles = fs.readdirSync(targetDir);
      const cachedFile = existingFiles.find((f) => f.startsWith(`${loc.locationId}.`) || f.startsWith(`${loc.locationId}_`));
      const cachedUrl = cachedFile
        ? MediaResolver.toMediaUrl(projectId, LOCATION_SUBFOLDER, cachedFile)
        : undefined;

      if (cachedFile && cachedUrl && !force && !isCustomRedo) {
        loc.imageUrl = cachedUrl;
        loc.versions = loc.versions || [];
        if (loc.versions.length === 0) {
          loc.versions.push({
            versionId: 'v_init',
            imageUrl: cachedUrl,
            promptZh: loc.promptZh || '',
            referenceImageUrl: loc.referenceImageUrl,
            createdAt: new Date().toISOString(),
          });
          loc.selectedVersionId = 'v_init';
        }
        return cachedUrl;
      }

      // 生成带版本时间戳的独立文件名，绝不覆盖历史资产
      const versionId = `v_${Date.now()}`;
      const customFilename = `${loc.locationId}_${versionId}`;

      // 物理调用生图
      try {
        const res = await (imageGenerateTool.execute as any)({
          context: {
            projectId,
            prompt,
            negativePrompt,
            referenceImageUrls: effectiveRefUrls,
            mode: effectiveRefUrls?.length ? 'scene_ref2i' : 'general_t2i',
            size: SCENE_ATMOSPHERE_SIZE,
            subfolder: LOCATION_SUBFOLDER,
            customFilename,
          },
        });

        const mediaUrl = res?.mediaUrl || res?.imageUrl;
        if (!res?.success || !mediaUrl) {
          throw new Error(res?.error || '场景空镜渲染失败：未返回有效图片地址');
        }

        loc.versions = loc.versions || [];
        if (loc.imageUrl && loc.versions.length === 0) {
          loc.versions.push({
            versionId: 'v_init',
            imageUrl: loc.imageUrl,
            promptZh: loc.promptZh || '',
            referenceImageUrl: loc.referenceImageUrl,
            createdAt: new Date().toISOString(),
          });
        }

        const newVersion = {
          versionId,
          imageUrl: mediaUrl,
          promptZh: prompt,
          negativePrompt: customNegativePrompt || undefined,
          instruction: instruction || undefined,
          derivedFromUrl: isCustomRedo ? effectiveRefUrls?.[0] : undefined,
          referenceImageUrl: loc.referenceImageUrl || undefined,
          createdAt: new Date().toISOString(),
        };
        loc.versions.push(newVersion);
        loc.selectedVersionId = versionId;
        loc.imageUrl = mediaUrl;
        return mediaUrl;
      } catch (err: any) {
        if (isAbortError(err)) throw err;
        throw new Error(`[SceneAtmosphereTool] 场景 [${loc.locationId}] 渲染失败: ${err?.message || err}`);
      }
    };

    // 归一化提取 targetLocationIds（支持单ID、ID数组、逗号分隔字符串或 locationIds）
    let targetLocIds: string[] = [];
    if (Array.isArray(locationId)) {
      targetLocIds = locationId.filter((id) => typeof id === 'string' && id.trim().length > 0);
    } else if (typeof locationId === 'string' && locationId.trim()) {
      targetLocIds = locationId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(input.locationIds)) {
      targetLocIds = input.locationIds.filter((id) => typeof id === 'string' && id.trim().length > 0);
    }

    // 1. 若未指定 locationId，批量渲染所有场景
    if (targetLocIds.length === 0) {
      const locs = entities.locations || [];
      for (const l of locs) {
        // 定过的坚决不动：仅为尚未定妆 (没有 imageUrl) 或显式 force 的场景生成
        if (force || !l.imageUrl) {
          await renderSingleLoc(l);
        }
      }
      store.setArtifact(projectId, 'lookdev_entities', entities);
      const scenesDir = path.join(store.getProjectDir(projectId), 'scenes');
      if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
      atomicWriteJsonSync(path.join(scenesDir, 'entities.json'), entities);
      return {
        projectId,
        locationId: 'all',
        imageUrl: locs[0]?.imageUrl,
        reused: false,
        success: true,
      };
    }

    // 2. 指定了单个场景，单体渲染
    if (targetLocIds.length === 1) {
      const targetId = targetLocIds[0];
      const loc = entities.locations?.find((l: any) => l.locationId === targetId || l.id === targetId);
      if (!loc) {
        throw new Error(`[SceneAtmosphereTool] 未在视觉资产中找到场景 [${targetId}]`);
      }

      const mediaUrl = await renderSingleLoc(loc);
      store.setArtifact(projectId, 'lookdev_entities', entities);
      const scenesDir = path.join(store.getProjectDir(projectId), 'scenes');
      if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
      atomicWriteJsonSync(path.join(scenesDir, 'entities.json'), entities);

      return {
        projectId,
        locationId: targetId,
        imageUrl: mediaUrl,
        reused: false,
        success: true,
      };
    }

    // 3. 指定了多个场景，批量逐一渲染落盘
    const matchedLocs: any[] = [];
    for (const id of targetLocIds) {
      const l = entities.locations?.find((item: any) => item.locationId === id || item.id === id);
      if (l) {
        matchedLocs.push(l);
      } else {
        console.warn(`[SceneAtmosphereTool] 批量渲染中跳过不存在的场景: ${id}`);
      }
    }

    if (matchedLocs.length === 0) {
      throw new Error(`[SceneAtmosphereTool] 未在视觉资产中找到指定的任何场景: [${targetLocIds.join(', ')}]`);
    }

    for (const l of matchedLocs) {
      await renderSingleLoc(l);
    }

    store.setArtifact(projectId, 'lookdev_entities', entities);
    const scenesDir = path.join(store.getProjectDir(projectId), 'scenes');
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
    atomicWriteJsonSync(path.join(scenesDir, 'entities.json'), entities);

    return {
      projectId,
      locationId: targetLocIds.join(','),
      imageUrl: matchedLocs[0]?.imageUrl,
      reused: false,
      success: true,
    };
  },
});
