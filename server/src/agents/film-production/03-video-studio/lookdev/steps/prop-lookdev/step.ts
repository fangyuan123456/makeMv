/**
 * agents/film-production/03-video-studio/lookdev/steps/prop-lookdev/step.ts
 * 道具定妆执行器与原子 Step
 */

import { createStep } from '@mastra/core/workflows';
import path from 'node:path';
import fs from 'node:fs';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { MediaResolver } from '../../../../../../media/MediaResolver.js';
import { imageGenerateTool } from '../../../../../../tools/image-generate/image-generate.tool.js';
import { isAbortError } from '../../../../../../workflow-engine/run-context.js';
import type { GlobalEntities } from '../../../../../../project-store/contracts/film-production/lookdev.js';

const ENTITY_SUBFOLDER = 'assets/entities';
import {
  PropLookdevInputSchema,
  PropLookdevOutputSchema,
  type PropLookdevInput,
  type PropLookdevOutput,
} from './schema.js';
import {
  buildPropLookdevPrompt,
  PROP_LOOKDEV_SIZE,
  PROP_LOOKDEV_NEGATIVE,
} from './prompt.js';

export async function renderPropLookdev(
  input: PropLookdevInput
): Promise<PropLookdevOutput> {
  const {
    projectId,
    itemId,
    force = false,
    customPrompt,
    customNegativePrompt,
    referenceImageUrls,
  } = input;
  const store = ProjectStore.getInstance();
  const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');

  if (!entities) {
    throw new Error(`[PropLookdev] 项目 [${projectId}] 尚未提取视觉资产`);
  }

  const item = entities.items.find((i: any) => i.itemId === itemId);
  if (!item) {
    throw new Error(`[PropLookdev] 未找到道具 [${itemId}]`);
  }

  // 若用户手动调整了提示词，持久化回写至道具设定
  if (customPrompt && customPrompt.trim()) {
    item.promptZh = customPrompt.trim();
  }

  const artStyle = entities.artStyle || '电影级写实光影质感，细节丰富，自然色彩影调';
  const prompt = customPrompt && customPrompt.trim()
    ? customPrompt.trim()
    : buildPropLookdevPrompt(item, artStyle);
  const negativePrompt = customNegativePrompt || PROP_LOOKDEV_NEGATIVE;

  const projectDir = store.getProjectDir(projectId);
  const targetDir = path.resolve(projectDir, ENTITY_SUBFOLDER);
  fs.mkdirSync(targetDir, { recursive: true });

  // 1. 检查磁盘已有同名资产缓存 (若带 customPrompt 或显式 force，则跳过缓存直接重做)
  const isCustomRedo = Boolean(customPrompt || referenceImageUrls?.length);
  const existingFiles = fs.readdirSync(targetDir);
  const cachedFile = existingFiles.find((f) => f.startsWith(`${itemId}.`));
  const cachedUrl = cachedFile
    ? MediaResolver.toMediaUrl(projectId, ENTITY_SUBFOLDER, cachedFile)
    : undefined;

  if (cachedUrl && !force && !isCustomRedo) {
    item.referenceImageUrl = cachedUrl;
    store.setArtifact(projectId, 'lookdev_entities', entities);
    return {
      projectId,
      itemId,
      imageUrl: cachedUrl,
      diskPath: `${ENTITY_SUBFOLDER}/${cachedFile}`,
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
        size: PROP_LOOKDEV_SIZE,
        subfolder: ENTITY_SUBFOLDER,
        customFilename: itemId,
      },
    });

    if (res?.success && res?.mediaUrl) {
      item.referenceImageUrl = res.mediaUrl;
      store.setArtifact(projectId, 'lookdev_entities', entities);
      const relPath = res.diskPath
        ? path.relative(projectDir, res.diskPath).split(path.sep).join('/')
        : undefined;
      return {
        projectId,
        itemId,
        imageUrl: res.mediaUrl,
        diskPath: relPath,
        reused: false,
        success: true,
      };
    }
  } catch (err: any) {
    if (isAbortError(err)) throw err;
    console.warn(`[PropLookdev] 道具 [${itemId}] 定妆出图异常:`, err);
  }

  return {
    projectId,
    itemId,
    imageUrl: cachedUrl,
    reused: false,
    success: Boolean(cachedUrl),
  };
}

export const propLookdevStep = createStep({
  id: 'step_lookdev_prop',
  description: '关键道具特写定妆工序 (1024*1024 中性灰底特写)',
  inputSchema: PropLookdevInputSchema,
  outputSchema: PropLookdevOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx;
    return await renderPropLookdev(input);
  },
});
