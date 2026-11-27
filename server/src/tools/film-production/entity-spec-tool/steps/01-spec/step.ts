/**
 * tools/film-production/entity-spec-tool/steps/01-spec/step.ts
 * 单实体视觉规格精细化推演执行工序 (Single Entity Spec Step)
 */

import crypto from 'node:crypto';
import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { resolveProjectStorySource } from '../../../../../project-store/story-source.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import type { GlobalEntities } from '../../../../../project-store/contracts/film-production/lookdev.js';
import { CharacterSpecSchema } from '../../character/index.js';
import { LocationSpecSchema } from '../../location/index.js';
import { ItemSpecSchema } from '../../item/index.js';
import {
  EntitySpecInputSchema,
  EntitySpecOutputSchema,
  type EntitySpecInput,
  type EntitySpecOutput,
} from './schema.js';
import { buildEntitySpecPrompt } from './prompt.js';

export const entitySpecStep = createStep({
  id: 'elaborate-single-entity-spec',
  description: '只针对单个角色、场景或道具执行从0到1深度视觉规格推演，与其他实体绝对物理隔离',
  inputSchema: EntitySpecInputSchema,
  outputSchema: EntitySpecOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as EntitySpecInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const storySource = input.prd || resolveProjectStorySource(input.projectId);
    const storyMarkdown = input.storyMarkdown || storySource?.scriptMarkdown || '';

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
      if (!targetId) targetId = `char_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    } else if (targetKind === 'location') {
      existingItem = (entities.locations || []).find(
        (l: any) => (targetId && l.locationId === targetId) || l.name === input.name
      );
      if (existingItem && !targetId) targetId = existingItem.locationId;
      if (!targetId) targetId = `loc_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    } else {
      existingItem = (entities.items || []).find(
        (i: any) => (targetId && i.itemId === targetId) || i.name === input.name
      );
      if (existingItem && !targetId) targetId = existingItem.itemId;
      if (!targetId) targetId = `item_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    }

    const agent = new Agent({
      name: 'entity-spec-designer',
      instructions: '你是资深电影概念造型与置景设计师。聚焦单个实体，根据剧本世界观输出最顶级的视觉造型设定。',
      model: LLMProvider.getModel(),
    });

    const knownCharacters = (entities.characters || []).map((c: any) => c.name).filter(Boolean);
    const knownLocations = (entities.locations || []).map((l: any) => l.name).filter(Boolean);
    const knownItems = (entities.items || []).map((i: any) => i.name).filter(Boolean);

    // 阻断旧数据污染：场景在推演时，绝不把旧的未收束 spatialLayout 回灌到提示词中，避免大模型注意力黏连照抄
    let cleanExistingSpec = existingItem;
    if (targetKind === 'location' && existingItem) {
      const { spatialLayout: _discarded, ...rest } = existingItem;
      cleanExistingSpec = rest;
    }

    const basePrompt = buildEntitySpecPrompt({
      targetKind,
      name: input.name,
      roleOrBrief: input.roleOrBrief,
      instruction: input.instruction,
      storyMarkdown,
      prd: storySource,
      artStyle: entities.artStyle,
      existingSpec: cleanExistingSpec,
      knownCharacters,
      knownLocations,
      knownItems,
    });

    const reflectionContext =
      (input as any)?._reflectionContext ||
      (input as any)?._context?.reflectionContext;
    const prompt = reflectionContext
      ? `${basePrompt}\n\n${reflectionContext}`
      : basePrompt;

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
      step: 'entity-spec-elaborate',
      label: `单实体规格推演·${input.name}`,
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
