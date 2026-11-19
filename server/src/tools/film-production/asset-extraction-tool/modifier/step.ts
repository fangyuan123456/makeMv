import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../../../../utils/atomicFile.js';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { ExtractedEntitiesSchema } from '../../../../project-store/contracts/film-production/lookdev.js';
import { mergeExtractedEntities, hydrateEntitiesWithDiskAssets } from '../../../../project-store/entity-preservation.js';
import {
  AssetExtractionModifierInputSchema,
  AssetExtractionModifierOutputSchema,
  type AssetExtractionModifierInput,
  type AssetExtractionModifierOutput,
} from './schema.js';

export const assetExtractionModifierStep = createStep({
  id: 'modify-visual-entities',
  description: '对已有角色、场景与道具资产执行新增或删除并原子落盘',
  inputSchema: AssetExtractionModifierInputSchema,
  outputSchema: AssetExtractionModifierOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as AssetExtractionModifierInput;
    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(input.projectId);
    const scenesDir = path.join(projectDir, 'scenes');
    const entitiesPath = path.join(scenesDir, 'entities.json');
    const originalEntities = store.getArtifact<any>(input.projectId, 'lookdev_entities') ||
      safeReadJsonSync<any>(entitiesPath) || { artStyle: '', characters: [], items: [], locations: [] };
    const entities = structuredClone(originalEntities);
    entities.characters = Array.isArray(entities.characters) ? entities.characters : [];
    entities.locations = Array.isArray(entities.locations) ? entities.locations : [];
    entities.items = Array.isArray(entities.items) ? entities.items : [];
    const deletedAssets: Array<{ directory: string; entityId: string }> = [];

    for (const change of input.modifications || []) {
      const entityType = change.entityType;
      const isCharacter = entityType === 'character';
      const isItem = entityType === 'item';
      const collection = isCharacter ? entities.characters : isItem ? entities.items : entities.locations;
      const idKey = isCharacter ? 'characterId' : isItem ? 'itemId' : 'locationId';
      const operation = change.operation || change.action;
      if (operation === 'delete') {
        const index = collection.findIndex((item: any) =>
          (change.entityId && item[idKey] === change.entityId) || (change.name && item.name === change.name));
        if (index < 0) continue;
        const removed = collection.splice(index, 1)[0];
        const assetDir = path.join(projectDir, 'assets', isCharacter || isItem ? 'entities' : 'locations');
        deletedAssets.push({ directory: assetDir, entityId: removed[idKey] });
        continue;
      }

      const source = change.entity || {};
      const name = change.name || source.name;
      if (!name) throw new Error(`新增${isCharacter ? '角色' : isItem ? '道具' : '场景'}缺少 name`);
      const generatedId = `${isCharacter ? 'char' : isItem ? 'item' : 'loc'}_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
      collection.push(isCharacter
        ? { ...source, characterId: source.characterId || generatedId, name, identity: source.identity || '', appearanceSummary: source.appearanceSummary || source.description || '', promptZh: source.promptZh || source.appearanceSummary || source.description || name, poseConstraint: source.poseConstraint || { stance: 'neutral' } }
        : isItem
          ? { ...source, itemId: source.itemId || generatedId, name, description: source.description || '', appearanceSummary: source.appearanceSummary || source.description || '', promptZh: source.promptZh || source.appearanceSummary || source.description || name }
          : { ...source, locationId: source.locationId || generatedId, name, atmosphere: source.atmosphere || source.description || '', appearanceSummary: source.appearanceSummary || source.description || '', promptZh: source.promptZh || source.appearanceSummary || source.description || name, sceneIds: Array.isArray(source.sceneIds) ? source.sceneIds : [] });
    }

    // 没有显式增删项时，按创作者指令重新阅读剧本与 PRD，只做视觉资产清单的增量补齐。
    if ((!input.modifications || input.modifications.length === 0) && input.instruction?.trim()) {
      const prd = input.prd || store.getArtifact(input.projectId, 'universal_prd');
      const storyMarkdown = input.storyMarkdown || store.getArtifact<string>(input.projectId, 'screenplay') || store.getArtifact<string>(input.projectId, 'story') || '';
      const agent = new Agent({ name: 'visual-asset-modifier-agent', instructions: '你是影视视觉资产总监。根据剧本、PRD、已有视觉资产和创作者指令，补齐或修正角色与场景提取结果。只修改指令涉及的资产，保留已有角色的 ID、定妆图、版本和参考图。每个角色必须输出 poseConstraint.stance：自然直立为 neutral，明确要求双脚并拢为 feet_together；promptZh 不得与该站姿冲突。输出完整的 GlobalEntities JSON。', model: LLMProvider.getModel() });
      const generated = await generateStructured({
        agent,
        prompt: `已有视觉资产：\n${JSON.stringify(entities)}\n\n剧本/故事：\n${storyMarkdown}\n\nPRD：\n${JSON.stringify(prd || {})}\n\n创作者干预指令：\n${input.instruction}\n\n请输出修正后的完整角色与场景资产清单。`,
        schema: ExtractedEntitiesSchema,
        stage: 'film-tool',
        step: 'visual-asset-modify',
        label: '视觉资产人工干预重提取',
      });
      const merged = mergeExtractedEntities(entities, generated, input.targetKinds);
      const hydrated = hydrateEntitiesWithDiskAssets(input.projectId, projectDir, merged);
      store.setArtifact(input.projectId, 'lookdev_entities', hydrated);
      if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
      atomicWriteJsonSync(entitiesPath, hydrated);
      return { projectId: input.projectId, entities: hydrated } as AssetExtractionModifierOutput;
    }

    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
    atomicWriteJsonSync(entitiesPath, entities);
    store.setArtifact(input.projectId, 'lookdev_entities', entities);
    for (const { directory, entityId } of deletedAssets) {
      if (!fs.existsSync(directory)) continue;
      for (const file of fs.readdirSync(directory)) {
        if (file.startsWith(`${entityId}_`) || file.startsWith(`${entityId}.`)) {
          try { fs.unlinkSync(path.join(directory, file)); } catch {}
        }
      }
    }
    return { projectId: input.projectId, entities } as AssetExtractionModifierOutput;
  },
});
