/**
 * tools/film-production/04-prop-lookdev-tool/steps/01-render/step.ts
 * 道具特写物理渲染工序执行器 (propLookdevStep)
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
  PropLookdevStepInputSchema,
  PropLookdevOutputSchema,
  type PropLookdevStepInput,
  type PropLookdevOutput,
} from './schema.js';
import {
  buildPropLookdevPrompt,
  PROP_LOOKDEV_SIZE,
  PROP_LOOKDEV_NEGATIVE,
} from './prompt.js';

const ENTITY_SUBFOLDER = 'assets/entities';

export const propLookdevStep = createStep({
  id: 'render-prop-lookdev',
  description: '调用物理生图算力与垫参考图，渲染单个道具特写高清静物图并落盘',
  inputSchema: PropLookdevStepInputSchema,
  outputSchema: PropLookdevOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as PropLookdevStepInput;
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
      throw new Error(`[PropLookdevTool] 项目 [${projectId}] 尚未提取视觉资产 lookdev_entities`);
    }

    const item = entities.items?.find((i: any) => i.itemId === itemId);
    if (!item) {
      throw new Error(`[PropLookdevTool] 未在视觉资产中找到道具 [${itemId}]`);
    }

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

    // 检查缓存
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
        itemId,
        propImageUrl: cachedUrl,
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
          mode: 'prop_t2i',
          size: PROP_LOOKDEV_SIZE,
          subfolder: ENTITY_SUBFOLDER,
          customFilename: itemId,
        },
      });

      if (res?.success && res?.mediaUrl) {
        item.referenceImageUrl = res.mediaUrl;
        store.setArtifact(projectId, 'lookdev_entities', entities);
        return {
          itemId,
          propImageUrl: res.mediaUrl,
          promptZh: prompt,
        };
      }
    } catch (err: any) {
      if (isAbortError(err)) throw err;
      throw new Error(`[PropLookdevTool] 道具 [${itemId}] 生图失败: ${err?.message || err}`);
    }

    throw new Error(`[PropLookdevTool] 道具 [${itemId}] 生图未返回有效媒体链接`);
  },
});
