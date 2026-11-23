import { ProjectStore } from '../../project-store/ProjectStore.js';
import { computeProjectStaleMap } from '../../project-store/freshness.js';
import type { ImageUpscaleMeta } from '../../project-store/contracts/film-production/lookdev.js';
import { getTaskHealthSnapshot } from '../runtime/task-health.js';

export function getActiveEntityUpscale(entity: any): ImageUpscaleMeta | undefined {
  if (!entity?.imageUrl || !Array.isArray(entity.versions) || entity.versions.length === 0) {
    return undefined;
  }
  const activeVersion =
    (entity.selectedVersionId
      ? entity.versions.find((v: any) => v.versionId === entity.selectedVersionId)
      : undefined) ||
    entity.versions.find((v: any) => v.imageUrl === entity.imageUrl) ||
    entity.versions[entity.versions.length - 1];
  return activeVersion?.upscale;
}

function formatImageAndUpscaleStatus(entity: any, readyLabel: string): string {
  if (!entity?.imageUrl) return '待定妆';
  const up = getActiveEntityUpscale(entity);
  return up ? `${readyLabel}（已超分 ${up.multiplier}×）` : `${readyLabel}（未超分）`;
}

function summarizeVisualSpec(entity: any): string {
  const raw = String(entity?.promptZh || entity?.appearanceSummary || entity?.description || '').trim();
  if (!raw) return '未定';
  return raw.length > 150 ? `${raw.slice(0, 150)}...` : raw;
}

export function getLookdevContext(projectId: string) {
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId) as any;
  const entities = (store.getArtifact(projectId, 'lookdev_entities') as any) || project?.entities || {};
  const prd = (store.getArtifact(projectId, 'prd') as any) || project?.prd || {};
  const characters: any[] = Array.isArray(entities.characters) ? entities.characters : [];
  const locations: any[] = Array.isArray(entities.locations) ? entities.locations : [];
  const items: any[] = Array.isArray(entities.items) ? entities.items : [];
  const pendingChars = characters.filter((character) => !character.imageUrl);
  const pendingLocs = locations.filter((location) => !location.imageUrl);
  const pendingItems = items.filter((item) => !item.imageUrl);
  const unupscaledChars = characters.filter((character) => Boolean(character.imageUrl) && !getActiveEntityUpscale(character));
  const unupscaledLocs = locations.filter((location) => Boolean(location.imageUrl) && !getActiveEntityUpscale(location));
  const unupscaledItems = items.filter((item) => Boolean(item.imageUrl) && !getActiveEntityUpscale(item));

  // 4. 全链路感知：设定已重新提炼或手改、导致旧定妆图过期的脏实体
  const staleMap = computeProjectStaleMap(projectId);
  const staleEntities = Object.entries(staleMap.entities || {}).map(([id, s]) => ({ id, ...s }));
  const staleChars = staleEntities.filter((e) => e.kind === 'character');
  const staleLocs = staleEntities.filter((e) => e.kind === 'location');
  const staleItems = staleEntities.filter((e) => e.kind === 'item');

  // 5. 任务流水健康感知：失败任务与进行中任务实时快照
  const taskHealth = getTaskHealthSnapshot(projectId, 'film.');

  return {
    project, entities, prd, characters, locations, items, pendingChars, pendingLocs, pendingItems,
    unupscaledChars, unupscaledLocs, unupscaledItems,
    staleMap, staleEntities, staleChars, staleLocs, staleItems,
    taskHealth,
    pendingCharIds: pendingChars.map((character) => character.characterId || character.id),
    pendingLocIds: pendingLocs.map((location) => location.locationId || location.id),
    pendingItemIds: pendingItems.map((item) => item.itemId || item.id),
    charSummary: characters.map((character) =>
      `- 角色[${character.name}](ID: ${character.characterId || character.id}): 身份=${character.identity || '未知'}, 实图造型=${summarizeVisualSpec(character)}, 定妆图=${formatImageAndUpscaleStatus(character, '已定妆')}`
    ).join('\n'),
    locSummary: locations.map((location) => {
      const layout = location.spatialLayout;
      const layoutDesc = layout ? ` 空间蓝图=[${layout}]` : '';
      return `- 场景[${location.name}](ID: ${location.locationId || location.id}): 氛围=${location.atmosphere || '未知'}, 陈设=${location.appearanceSummary || '未知'}, 概念图=${formatImageAndUpscaleStatus(location, '已出图')}${layoutDesc}`;
    }).join('\n'),
    itemSummary: items.map((item) =>
      `- 道具[${item.name}](ID: ${item.itemId || item.id}): 实图设定=${summarizeVisualSpec(item)}, 特写=${formatImageAndUpscaleStatus(item, '已出图')}`
    ).join('\n'),
  };
}
