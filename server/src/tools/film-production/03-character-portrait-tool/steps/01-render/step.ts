/**
 * tools/film-production/03-character-portrait-tool/steps/01-render/step.ts
 * 角色立绘物理渲染工序执行器 (characterPortraitStep)
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
  CharacterPortraitStepInputSchema,
  CharacterPortraitOutputSchema,
  type CharacterPortraitStepInput,
  type CharacterPortraitOutput,
} from './schema.js';
import {
  buildCharacterPortraitPrompt,
  CHARACTER_PORTRAIT_SIZE,
  CHARACTER_PORTRAIT_NEGATIVE,
} from './prompt.js';

const ENTITY_SUBFOLDER = 'assets/entities';

export const characterPortraitStep = createStep({
  id: 'render-character-portrait',
  description: '调用物理生图算力与垫参考图，渲染单个角色高清全身定妆立绘并落盘',
  inputSchema: CharacterPortraitStepInputSchema,
  outputSchema: CharacterPortraitOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as CharacterPortraitStepInput;
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
      throw new Error(`[CharacterPortraitTool] 项目 [${projectId}] 尚未提取视觉资产 lookdev_entities`);
    }

    const char = entities.characters?.find((c: any) => c.characterId === characterId);
    if (!char) {
      throw new Error(`[CharacterPortraitTool] 未在视觉资产中找到角色 [${characterId}]`);
    }

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

    // 检查缓存
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
        characterId,
        portraitImageUrl: cachedUrl,
        promptZh: prompt,
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
          mode: 'character_t2i',
          size: CHARACTER_PORTRAIT_SIZE,
          subfolder: ENTITY_SUBFOLDER,
          customFilename: characterId,
        },
      });

      if (res?.success && res?.mediaUrl) {
        char.referenceImageUrl = res.mediaUrl;
        store.setArtifact(projectId, 'lookdev_entities', entities);
        return {
          characterId,
          portraitImageUrl: res.mediaUrl,
          promptZh: prompt,
        };
      }
    } catch (err: any) {
      if (isAbortError(err)) throw err;
      throw new Error(`[CharacterPortraitTool] 角色 [${characterId}] 生图失败: ${err?.message || err}`);
    }

    throw new Error(`[CharacterPortraitTool] 角色 [${characterId}] 生图未返回有效媒体链接`);
  },
});
