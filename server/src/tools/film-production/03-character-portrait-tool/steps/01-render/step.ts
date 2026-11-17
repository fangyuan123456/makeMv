/**
 * tools/film-production/03-character-portrait-tool/steps/01-render/step.ts
 * 角色立绘物理渲染工序执行器 (characterPortraitStep)
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
      instruction,
      customPrompt,
      customNegativePrompt,
      referenceImageUrls,
    } = input;

    const store = ProjectStore.getInstance();
    const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');

    if (!entities) {
      throw new Error(`[CharacterPortraitTool] 项目 [${projectId}] 尚未提取视觉资产 lookdev_entities`);
    }

    const renderSingle = async (char: any): Promise<string> => {
      if (customPrompt && customPrompt.trim()) {
        char.promptZh = customPrompt.trim();
      }

      // 提取垫图（优先显式传入，其次为实体已绑定的 referenceImageUrl）
      const effectiveRefUrls =
        referenceImageUrls && referenceImageUrls.length
          ? referenceImageUrls
          : char.referenceImageUrl
          ? [char.referenceImageUrl]
          : undefined;

      const artStyle = entities.artStyle || '电影级写实光影质感，细节丰富，自然色彩影调';
      const prompt = buildCharacterPortraitPrompt(char, artStyle, Boolean(effectiveRefUrls?.length));
      const negativePrompt = customNegativePrompt
        ? `${customNegativePrompt}，${CHARACTER_PORTRAIT_NEGATIVE}`
        : CHARACTER_PORTRAIT_NEGATIVE;

      const projectDir = store.getProjectDir(projectId);
      const targetDir = path.resolve(projectDir, ENTITY_SUBFOLDER);
      fs.mkdirSync(targetDir, { recursive: true });

      const isCustomRedo = Boolean(customPrompt || referenceImageUrls?.length);

      // 若已有定妆且未要求强制重新生成，坚决不动已定妆资产
      if (char.imageUrl && !force && !isCustomRedo) {
        console.log(`[CharacterPortraitTool] 角色 [${char.characterId}] 已有定妆资产，保留不重新生成: ${char.imageUrl}`);
        return char.imageUrl;
      }

      const existingFiles = fs.readdirSync(targetDir);
      const cachedFile = existingFiles.find((f) => f.startsWith(`${char.characterId}.`) || f.startsWith(`${char.characterId}_`));
      const cachedUrl = cachedFile
        ? MediaResolver.toMediaUrl(projectId, ENTITY_SUBFOLDER, cachedFile)
        : undefined;

      if (cachedUrl && !force && !isCustomRedo) {
        char.imageUrl = cachedUrl;
        char.versions = char.versions || [];
        if (char.versions.length === 0) {
          char.versions.push({
            versionId: 'v_init',
            imageUrl: cachedUrl,
            promptZh: char.promptZh || '',
            referenceImageUrl: char.referenceImageUrl,
            createdAt: new Date().toISOString(),
          });
          char.selectedVersionId = 'v_init';
        }
        return cachedUrl;
      }

      // 生成带版本时间戳的独立文件名，绝不覆盖历史资产
      const versionId = `v_${Date.now()}`;
      const customFilename = `${char.characterId}_${versionId}`;

      // 物理调用生图
      try {
        const res = await (imageGenerateTool.execute as any)({
          context: {
            projectId,
            prompt,
            negativePrompt,
            referenceImageUrls: effectiveRefUrls,
            mode: effectiveRefUrls?.length ? 'character_three_view' : 'character_t2i',
            size: CHARACTER_PORTRAIT_SIZE,
            subfolder: ENTITY_SUBFOLDER,
            customFilename,
          },
        });

        if (res?.success && res?.mediaUrl) {
          char.versions = char.versions || [];
          // 若原本有历史图片且未收录到 versions 中，先归档初版
          if (char.imageUrl && char.versions.length === 0) {
            char.versions.push({
              versionId: 'v_init',
              imageUrl: char.imageUrl,
              promptZh: char.promptZh || '',
              referenceImageUrl: char.referenceImageUrl,
              createdAt: new Date().toISOString(),
            });
          }

          const newVersion = {
            versionId,
            imageUrl: res.mediaUrl,
            promptZh: char.promptZh,
            negativePrompt: customNegativePrompt || undefined,
            instruction: instruction || undefined,
            derivedFromUrl: isCustomRedo ? effectiveRefUrls?.[0] : undefined,
            referenceImageUrl: char.referenceImageUrl || undefined,
            createdAt: new Date().toISOString(),
          };
          char.versions.push(newVersion);
          char.selectedVersionId = versionId;
          char.imageUrl = res.mediaUrl;
          return res.mediaUrl;
        }
      } catch (err: any) {
        if (isAbortError(err)) throw err;
        throw new Error(`[CharacterPortraitTool] 角色 [${char.characterId}] 生图失败: ${err?.message || err}`);
      }

      throw new Error(`[CharacterPortraitTool] 角色 [${char.characterId}] 生图未返回有效媒体链接`);
    };

    // 归一化提取 targetCharacterIds（支持单ID、ID数组、逗号分隔字符串或 characterIds）
    let targetIds: string[] = [];
    if (Array.isArray(characterId)) {
      targetIds = characterId.filter((id) => typeof id === 'string' && id.trim().length > 0);
    } else if (typeof characterId === 'string' && characterId.trim()) {
      targetIds = characterId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(input.characterIds)) {
      targetIds = input.characterIds.filter((id) => typeof id === 'string' && id.trim().length > 0);
    }

    // 1. 若未指定任何角色 ID，自动批量为所有未定妆角色生成
    if (targetIds.length === 0) {
      const chars = entities.characters || [];
      let count = 0;
      for (const c of chars) {
        // 定过的坚决不动：仅为尚未定妆 (没有 imageUrl) 或显式 force 的角色生成
        if (force || !c.imageUrl) {
          await renderSingle(c);
          count++;
        }
      }
      store.setArtifact(projectId, 'lookdev_entities', entities);
      const scenesDir = path.join(store.getProjectDir(projectId), 'scenes');
      if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
      atomicWriteJsonSync(path.join(scenesDir, 'entities.json'), entities);
      return {
        characterId: 'all',
        portraitImageUrl: chars[0]?.imageUrl || '',
        renderedCount: count,
      };
    }

    // 2. 指定了单个角色，单体渲染
    if (targetIds.length === 1) {
      const targetId = targetIds[0];
      const char = entities.characters?.find((c: any) => c.characterId === targetId || c.id === targetId);
      if (!char) {
        throw new Error(`[CharacterPortraitTool] 未在视觉资产中找到角色 [${targetId}]`);
      }

      const url = await renderSingle(char);
      store.setArtifact(projectId, 'lookdev_entities', entities);
      const scenesDir = path.join(store.getProjectDir(projectId), 'scenes');
      if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
      atomicWriteJsonSync(path.join(scenesDir, 'entities.json'), entities);
      return {
        characterId: targetId,
        portraitImageUrl: url,
        promptZh: char.promptZh,
        renderedCount: 1,
      };
    }

    // 3. 指定了多个角色，批量逐一渲染落盘
    const matchedChars: any[] = [];
    for (const id of targetIds) {
      const c = entities.characters?.find((item: any) => item.characterId === id || item.id === id);
      if (c) {
        matchedChars.push(c);
      } else {
        console.warn(`[CharacterPortraitTool] 批量定妆中跳过不存在的角色: ${id}`);
      }
    }

    if (matchedChars.length === 0) {
      throw new Error(`[CharacterPortraitTool] 未在视觉资产中找到指定的任何角色: [${targetIds.join(', ')}]`);
    }

    let renderedCount = 0;
    for (const c of matchedChars) {
      await renderSingle(c);
      renderedCount++;
    }

    store.setArtifact(projectId, 'lookdev_entities', entities);
    const scenesDir = path.join(store.getProjectDir(projectId), 'scenes');
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
    atomicWriteJsonSync(path.join(scenesDir, 'entities.json'), entities);

    return {
      characterId: targetIds.join(','),
      portraitImageUrl: matchedChars[0]?.imageUrl || '',
      renderedCount,
    };
  },
});
