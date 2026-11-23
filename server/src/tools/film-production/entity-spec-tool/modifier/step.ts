/**
 * tools/film-production/entity-spec-tool/modifier/step.ts
 * 单实体视觉规格增量微调工序 (Entity Spec Modifier Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import type { GlobalEntities } from '../../../../project-store/contracts/film-production/lookdev.js';
import { CharacterSpecSchema } from '../character/index.js';
import { LocationSpecSchema } from '../location/index.js';
import { ItemSpecSchema } from '../item/index.js';
import {
  EntitySpecModifierInputSchema,
  EntitySpecModifierOutputSchema,
  type EntitySpecModifierInput,
  type EntitySpecModifierOutput,
} from './schema.js';
import { buildEntitySpecModifyPrompt } from './prompt.js';

export const entitySpecModifierStep = createStep({
  id: 'entity-spec-modifier-step',
  description: '单实体视觉规格定向微调（支持自定义提示词直接覆盖与 LLM 增量融合）',
  inputSchema: EntitySpecModifierInputSchema,
  outputSchema: EntitySpecModifierOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as EntitySpecModifierInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const storyMarkdown =
      input.storyMarkdown ||
      store.getArtifact<string>(input.projectId, 'screenplay') ||
      store.getArtifact<string>(input.projectId, 'story') ||
      '';

    const entities = store.getArtifact<GlobalEntities>(input.projectId, 'lookdev_entities') || {
      artStyle: '电影实拍质感',
      characters: [],
      locations: [],
      items: [],
    };

    const targetKind = input.targetKind;
    let existingItem: any = null;
    let targetId = input.targetId;

    if (targetKind === 'character') {
      existingItem = (entities.characters || []).find(
        (c: any) => (targetId && c.characterId === targetId) || c.name === input.name
      );
      if (existingItem && !targetId) targetId = existingItem.characterId;
    } else if (targetKind === 'location') {
      existingItem = (entities.locations || []).find(
        (l: any) => (targetId && l.locationId === targetId) || l.name === input.name
      );
      if (existingItem && !targetId) targetId = existingItem.locationId;
    } else {
      existingItem = (entities.items || []).find(
        (i: any) => (targetId && i.itemId === targetId) || i.name === input.name
      );
      if (existingItem && !targetId) targetId = existingItem.itemId;
    }

    targetId = targetId || `${targetKind.slice(0, 4)}_${Date.now()}`;

    // 快捷路径：若直接提供了创作者自定义提示词 (customPrompt)，无损继承原有属性并替换 promptZh，零 LLM 消耗
    if (input.customPrompt && input.customPrompt.trim()) {
      const merged: any = {
        ...(existingItem || {}),
        promptZh: input.customPrompt.trim(),
      };
      if (targetKind === 'character') {
        merged.characterId = targetId;
        merged.name = input.name;
        merged.appearanceSummary = merged.appearanceSummary || input.name;
        return {
          projectId: input.projectId,
          targetKind,
          targetId,
          name: input.name,
          character: merged,
        };
      } else if (targetKind === 'location') {
        merged.locationId = targetId;
        merged.name = input.name;
        merged.atmosphere = merged.atmosphere || input.name;
        return {
          projectId: input.projectId,
          targetKind,
          targetId,
          name: input.name,
          location: merged,
        };
      } else {
        merged.itemId = targetId;
        merged.name = input.name;
        merged.appearanceSummary = merged.appearanceSummary || input.name;
        return {
          projectId: input.projectId,
          targetKind,
          targetId,
          name: input.name,
          item: merged,
        };
      }
    }

    // 增量大模型微调
    const agent = new Agent({
      name: 'entity-spec-modifier-designer',
      instructions: '你是资深电影概念造型与置景设计师。聚焦单个实体，在保留原有设定的核心基础上进行增量微调。',
      model: LLMProvider.getModel(),
    });

    const knownCharacters = (entities.characters || []).map((c: any) => c.name).filter(Boolean);
    const knownLocations = (entities.locations || []).map((l: any) => l.name).filter(Boolean);
    const knownItems = (entities.items || []).map((i: any) => i.name).filter(Boolean);

    const prompt = buildEntitySpecModifyPrompt({
      targetKind,
      name: input.name,
      existingSpec: existingItem,
      instruction: input.instruction || '优化此实体的视觉细节规格',
      artStyle: entities.artStyle,
      storyMarkdown,
      knownCharacters,
      knownLocations,
      knownItems,
    });

    const targetSchema =
      targetKind === 'character'
        ? CharacterSpecSchema
        : targetKind === 'location'
        ? LocationSpecSchema
        : ItemSpecSchema;

    const generated = (await generateStructured({
      agent,
      prompt,
      schema: targetSchema,
      stage: 'film-tool',
      step: 'entity-spec-modify',
      label: `单实体规格修改·${input.name}`,
      abortSignal,
    })) as any;

    if (targetKind === 'character') {
      generated.characterId = targetId;
      generated.name = input.name;
      if (existingItem?.imageUrl) generated.imageUrl = existingItem.imageUrl;
      if (existingItem?.referenceImageUrl) generated.referenceImageUrl = existingItem.referenceImageUrl;
      if (existingItem?.firstFrameUpscale) generated.firstFrameUpscale = existingItem.firstFrameUpscale;
      if (existingItem?.versions) generated.versions = existingItem.versions;
      return {
        projectId: input.projectId,
        targetKind,
        targetId,
        name: input.name,
        character: generated,
      };
    } else if (targetKind === 'location') {
      generated.locationId = targetId;
      generated.name = input.name;
      if (existingItem?.imageUrl) generated.imageUrl = existingItem.imageUrl;
      if (existingItem?.referenceImageUrl) generated.referenceImageUrl = existingItem.referenceImageUrl;
      if (existingItem?.versions) generated.versions = existingItem.versions;
      return {
        projectId: input.projectId,
        targetKind,
        targetId,
        name: input.name,
        location: generated,
      };
    } else {
      generated.itemId = targetId;
      generated.name = input.name;
      if (existingItem?.imageUrl) generated.imageUrl = existingItem.imageUrl;
      if (existingItem?.referenceImageUrl) generated.referenceImageUrl = existingItem.referenceImageUrl;
      if (existingItem?.versions) generated.versions = existingItem.versions;
      return {
        projectId: input.projectId,
        targetKind,
        targetId,
        name: input.name,
        item: generated,
      };
    }
  },
});
