/**
 * tools/film-production/asset-manifest-tool/modifier/step.ts
 * 资产骨架清单微调执行工序 (Asset Manifest Modifier Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import {
  AssetManifestModifierInputSchema,
  AssetManifestModifierOutputSchema,
  type AssetManifestModifierInput,
  type AssetManifestModifierOutput,
} from './schema.js';
import { buildAssetManifestModifyPrompt } from './prompt.js';

export const assetManifestModifierStep = createStep({
  id: 'asset-manifest-modifier-step',
  description: '对全剧核心资产清单执行增删改定向调整（支持结构化高精度操作与自然语言 LLM 微调）',
  inputSchema: AssetManifestModifierInputSchema,
  outputSchema: AssetManifestModifierOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as AssetManifestModifierInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const existingEntities = store.getArtifact<any>(input.projectId, 'lookdev_entities') || {
      characters: [],
      locations: [],
      items: [],
    };

    let characters: any[] = (existingEntities.characters || []).map((c: any) => ({
      characterId: c.characterId,
      name: c.name,
      role: c.role || c.identity || '配角',
      brief: c.appearanceSummary || c.brief || '',
      tier: c.tier || 'secondary',
    }));
    let locations: any[] = (existingEntities.locations || []).map((l: any) => ({
      locationId: l.locationId,
      name: l.name,
      type: l.type || '室内',
      brief: l.atmosphere || l.brief || '',
      importance: l.importance || 'medium',
    }));
    let items: any[] = (existingEntities.items || []).map((i: any) => ({
      itemId: i.itemId,
      name: i.name,
      category: i.category || '道具',
      brief: i.appearanceSummary || i.brief || '',
      isKeyItem: i.isKeyItem ?? true,
    }));

    // 结构化极速操作通道：若传入 modifications 清单，直接执行 0 LLM 增删改
    if (Array.isArray(input.modifications) && input.modifications.length > 0) {
      for (const mod of input.modifications) {
        if (mod.entityKind === 'character') {
          if (mod.action === 'delete') {
            characters = characters.filter((c) => {
              if (mod.targetId && c.characterId === mod.targetId) return false;
              if (mod.name && c.name === mod.name) return false;
              return true;
            });
          } else if (mod.action === 'rename' && mod.newName) {
            const target = characters.find((c) => (mod.targetId && c.characterId === mod.targetId) || (mod.name && c.name === mod.name));
            if (target) target.name = mod.newName;
          } else if (mod.action === 'add' && mod.entity) {
            characters.push({
              characterId: mod.targetId,
              name: mod.name || (mod.entity as any).name || '新角色',
              role: (mod.entity as any).role || '配角',
              brief: (mod.entity as any).brief || '',
              tier: (mod.entity as any).tier || 'secondary',
            });
          } else if (mod.action === 'update' && mod.entity) {
            const target = characters.find((c) => (mod.targetId && c.characterId === mod.targetId) || (mod.name && c.name === mod.name));
            if (target) Object.assign(target, mod.entity);
          }
        } else if (mod.entityKind === 'location') {
          if (mod.action === 'delete') {
            locations = locations.filter((l) => {
              if (mod.targetId && l.locationId === mod.targetId) return false;
              if (mod.name && l.name === mod.name) return false;
              return true;
            });
          } else if (mod.action === 'rename' && mod.newName) {
            const target = locations.find((l) => (mod.targetId && l.locationId === mod.targetId) || (mod.name && l.name === mod.name));
            if (target) target.name = mod.newName;
          } else if (mod.action === 'add' && mod.entity) {
            locations.push({
              locationId: mod.targetId,
              name: mod.name || (mod.entity as any).name || '新场景',
              type: (mod.entity as any).type || '室内',
              brief: (mod.entity as any).brief || '',
              importance: (mod.entity as any).importance || 'medium',
            });
          } else if (mod.action === 'update' && mod.entity) {
            const target = locations.find((l) => (mod.targetId && l.locationId === mod.targetId) || (mod.name && l.name === mod.name));
            if (target) Object.assign(target, mod.entity);
          }
        } else if (mod.entityKind === 'item') {
          if (mod.action === 'delete') {
            items = items.filter((i) => {
              if (mod.targetId && i.itemId === mod.targetId) return false;
              if (mod.name && i.name === mod.name) return false;
              return true;
            });
          } else if (mod.action === 'rename' && mod.newName) {
            const target = items.find((i) => (mod.targetId && i.itemId === mod.targetId) || (mod.name && i.name === mod.name));
            if (target) target.name = mod.newName;
          } else if (mod.action === 'add' && mod.entity) {
            items.push({
              itemId: mod.targetId,
              name: mod.name || (mod.entity as any).name || '新道具',
              category: (mod.entity as any).category || '道具',
              brief: (mod.entity as any).brief || '',
              isKeyItem: (mod.entity as any).isKeyItem ?? true,
            });
          } else if (mod.action === 'update' && mod.entity) {
            const target = items.find((i) => (mod.targetId && i.itemId === mod.targetId) || (mod.name && i.name === mod.name));
            if (target) Object.assign(target, mod.entity);
          }
        }
      }

      return {
        projectId: input.projectId,
        artStyle: existingEntities.artStyle || '电影实拍质感与光影分级',
        characters,
        locations,
        items,
      };
    }

    // 自然语言指令微调通道
    const agent = new Agent({
      name: 'asset-manifest-modifier',
      instructions: '你是资深影视制片统筹。严格依据创作者指令，对既有资产清单进行增删改微调，输出标准结构。',
      model: LLMProvider.getModel(),
    });

    const prompt = buildAssetManifestModifyPrompt({
      existingCharacters: characters,
      existingLocations: locations,
      existingItems: items,
      instruction: input.instruction || '优化当前资产清单',
    });

    const result = (await generateStructured({
      agent,
      prompt,
      schema: AssetManifestModifierOutputSchema.omit({ projectId: true }),
      stage: 'film-tool',
      step: 'asset-manifest-modify',
      label: '资产清单修改',
      abortSignal,
    })) as AssetManifestModifierOutput;

    return {
      projectId: input.projectId,
      artStyle: (result as any).artStyle || existingEntities.artStyle || '电影实拍质感与光影分级',
      characters: result.characters || characters,
      locations: result.locations || locations,
      items: result.items || items,
    };
  },
});
