/**
 * agents/film-production/03-video-studio/lookdev/steps/character-portrait/step.ts
 * 角色立绘定妆执行器与原子 Step
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
  CharacterPortraitInputSchema,
  CharacterPortraitOutputSchema,
  type CharacterPortraitInput,
  type CharacterPortraitOutput,
} from './schema.js';
import {
  buildCharacterPortraitPrompt,
  CHARACTER_PORTRAIT_SIZE,
  CHARACTER_PORTRAIT_NEGATIVE,
} from './prompt.js';

export async function renderCharacterPortrait(
  input: CharacterPortraitInput
): Promise<CharacterPortraitOutput> {
  const {
    projectId,
    characterId,
    force = false,
    customPrompt,
    customNegativePrompt,
    referenceImageUrls,
  } = input;
  const store = ProjectStore.getInstance();
  const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');

  if (!entities) {
    throw new Error(`[CharacterPortrait] 项目 [${projectId}] 尚未提取视觉资产`);
  }

  const char = entities.characters.find((c: any) => c.characterId === characterId);
  if (!char) {
    throw new Error(`[CharacterPortrait] 未找到角色 [${characterId}]`);
  }

  // 若用户手动调整了提示词，持久化回写至角色设定
  if (customPrompt && customPrompt.trim()) {
    char.promptZh = customPrompt.trim();
  }

  const artStyle = entities.artStyle || '电影级写实光影质感，细节丰富，自然色彩影调';
  const prompt = customPrompt && customPrompt.trim()
    ? customPrompt.trim()
    : buildCharacterPortraitPrompt(char, artStyle);
  const negativePrompt = customNegativePrompt || CHARACTER_PORTRAIT_NEGATIVE;

  const projectDir = store.getProjectDir(projectId);
  const targetDir = path.resolve(projectDir, ENTITY_SUBFOLDER);
  fs.mkdirSync(targetDir, { recursive: true });

  // 1. 检查磁盘已有同名资产缓存 (若带 customPrompt 或显式 force，则跳过缓存直接重做)
  const isCustomRedo = Boolean(customPrompt || referenceImageUrls?.length);
  const existingFiles = fs.readdirSync(targetDir);
  const cachedFile = existingFiles.find((f) => f.startsWith(`${characterId}.`));
  const cachedUrl = cachedFile
    ? MediaResolver.toMediaUrl(projectId, ENTITY_SUBFOLDER, cachedFile)
    : undefined;

  if (cachedUrl && !force && !isCustomRedo) {
    char.referenceImageUrl = cachedUrl;
    store.setArtifact(projectId, 'lookdev_entities', entities);
    return {
      projectId,
      characterId,
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
        mode: 'character_t2i',
        size: CHARACTER_PORTRAIT_SIZE,
        subfolder: ENTITY_SUBFOLDER,
        customFilename: characterId,
      },
    });

    if (res?.success && res?.mediaUrl) {
      char.referenceImageUrl = res.mediaUrl;
      store.setArtifact(projectId, 'lookdev_entities', entities);
      const relPath = res.diskPath
        ? path.relative(projectDir, res.diskPath).split(path.sep).join('/')
        : undefined;
      return {
        projectId,
        characterId,
        imageUrl: res.mediaUrl,
        diskPath: relPath,
        reused: false,
        success: true,
      };
    }
  } catch (err: any) {
    if (isAbortError(err)) throw err;
    console.warn(`[CharacterPortrait] 角色 [${characterId}] 定妆出图异常:`, err);
  }

  return {
    projectId,
    characterId,
    imageUrl: cachedUrl,
    reused: false,
    success: Boolean(cachedUrl),
  };
}

export const characterPortraitStep = createStep({
  id: 'step_lookdev_character_portrait',
  description: '角色全身立绘定妆工序 (768*1344 中性灰底工作室照)',
  inputSchema: CharacterPortraitInputSchema,
  outputSchema: CharacterPortraitOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx;
    return await renderCharacterPortrait(input);
  },
});
