/**
 * project-store/entity-preservation.ts
 * 实体资产保护与磁盘物理文件自愈水合器 (Entity Preservation & Auto-Healing SSOT)
 *
 * 保证：
 * 1. 重新提取设定或重载工程时，永不丢失已有定妆、参考图与版本库；
 * 2. 依据物理磁盘真实的图片文件自动自愈水合。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from './ProjectStore.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../utils/atomicFile.js';

function extractVersionMetaFromFile(file: string): { versionId: string; createdAt: string } {
  // 现代规范：_v_1795146173537_vbhx.png -> versionId: v_1795146173537_vbhx
  const modernMatch = file.match(/_(v_\d+_[a-zA-Z0-9_-]+)\./);
  // 经典规范：_v_1795144097110.png -> versionId: v_1795144097110
  const legacyMatch = file.match(/_v_(\d+)\./);
  const versionId = modernMatch
    ? modernMatch[1]
    : legacyMatch
    ? `v_${legacyMatch[1]}`
    : `v_${file.replace(/[^a-zA-Z0-9]/g, '_')}`;

  const timestampMatch = file.match(/_v_(\d+)/);
  const createdAt = timestampMatch
    ? new Date(Number(timestampMatch[1])).toISOString()
    : new Date().toISOString();

  return { versionId, createdAt };
}

/**
 * 清洗并过滤实体版本列表中的重复项（根据 versionId 与 imageUrl 双重幂等收敛）
 */
export function sanitizeEntityVersions(versions: any[]): { versions: any[]; modified: boolean } {
  if (!Array.isArray(versions) || versions.length <= 1) return { versions: versions || [], modified: false };
  const seenId = new Set<string>();
  const seenUrl = new Set<string>();
  const deduped: any[] = [];
  let modified = false;

  for (const v of versions) {
    if (!v) continue;
    const vId = v.versionId;
    const vUrl = v.imageUrl;
    // 如果已经存在相同的 versionId 或 imageUrl，视为重复版本予以收敛过滤
    if ((vId && seenId.has(vId)) || (vUrl && seenUrl.has(vUrl))) {
      modified = true;
      continue;
    }
    if (vId) seenId.add(vId);
    if (vUrl) seenUrl.add(vUrl);
    deduped.push(v);
  }

  return { versions: deduped, modified };
}

export function hydrateEntitiesWithDiskAssets(
  projectId: string,
  projectDir: string,
  entities: any
): any {
  if (!entities) return entities;
  let modified = false;
  const store = ProjectStore.getInstance();

  // 0. 先行自愈清洗已有资产的 versions 清单，剔除历史重复项
  ['characters', 'locations', 'items'].forEach((key) => {
    (entities[key] || []).forEach((entity: any) => {
      const sanitized = sanitizeEntityVersions(entity.versions || []);
      entity.versions = sanitized.versions;
      if (sanitized.modified) modified = true;
    });
  });

  // 1. 扫描角色物理定妆立绘 (assets/entities)
  const charDir = path.join(projectDir, 'assets', 'entities');
  if (fs.existsSync(charDir)) {
    const files = fs.readdirSync(charDir);
    (entities.characters || []).forEach((char: any) => {
      char.versions = char.versions || [];
      const matchedFiles = files.filter(
        (f) =>
          f.startsWith(`${char.characterId}_`) ||
          f.startsWith(`${char.characterId}.`)
      );

      matchedFiles.forEach((file) => {
        const mediaUrl = `/media/${encodeURIComponent(projectId)}/assets/entities/${encodeURIComponent(file)}`;
        const { versionId, createdAt } = extractVersionMetaFromFile(file);

        if (
          !char.versions.some(
            (v: any) => v.imageUrl === mediaUrl || v.versionId === versionId
          )
        ) {
          char.versions.push({
            versionId,
            imageUrl: mediaUrl,
            promptZh: char.promptZh || '',
            referenceImageUrl: char.referenceImageUrl,
            createdAt,
          });
          modified = true;
        }
      });

      // 若当前没有激活图片但存在版本，自动绑定最新版本
      if (!char.imageUrl && char.versions.length > 0) {
        const latest = char.versions[char.versions.length - 1];
        char.imageUrl = latest.imageUrl;
        char.selectedVersionId = latest.versionId;
        modified = true;
      }
    });

    // 1.5 扫描道具物理特写图 (assets/entities)
    (entities.items || []).forEach((item: any) => {
      item.versions = item.versions || [];
      const itemId = item.itemId || item.id;
      if (!itemId) return;
      const matchedFiles = files.filter(
        (f) => f.startsWith(`${itemId}_`) || f.startsWith(`${itemId}.`)
      );

      matchedFiles.forEach((file) => {
        const mediaUrl = `/media/${encodeURIComponent(projectId)}/assets/entities/${encodeURIComponent(file)}`;
        const { versionId, createdAt } = extractVersionMetaFromFile(file);

        if (
          !item.versions.some(
            (v: any) => v.imageUrl === mediaUrl || v.versionId === versionId
          )
        ) {
          item.versions.push({
            versionId,
            imageUrl: mediaUrl,
            promptZh: item.promptZh || '',
            referenceImageUrl: item.referenceImageUrl,
            createdAt,
          });
          modified = true;
        }
      });

      if (!item.imageUrl && item.versions.length > 0) {
        const latest = item.versions[item.versions.length - 1];
        item.imageUrl = latest.imageUrl;
        item.selectedVersionId = latest.versionId;
        modified = true;
      }
    });
  }

  // 2. 扫描场景物理空镜 (assets/locations)
  const locDir = path.join(projectDir, 'assets', 'locations');
  if (fs.existsSync(locDir)) {
    const files = fs.readdirSync(locDir);
    (entities.locations || []).forEach((loc: any) => {
      loc.versions = loc.versions || [];
      const matchedFiles = files.filter(
        (f) =>
          f.startsWith(`${loc.locationId}_`) ||
          f.startsWith(`${loc.locationId}.`)
      );

      matchedFiles.forEach((file) => {
        const mediaUrl = `/media/${encodeURIComponent(projectId)}/assets/locations/${encodeURIComponent(file)}`;
        const { versionId, createdAt } = extractVersionMetaFromFile(file);

        if (
          !loc.versions.some(
            (v: any) => v.imageUrl === mediaUrl || v.versionId === versionId
          )
        ) {
          loc.versions.push({
            versionId,
            imageUrl: mediaUrl,
            promptZh: loc.promptZh || '',
            referenceImageUrl: loc.referenceImageUrl,
            createdAt,
          });
          modified = true;
        }
      });

      if (!loc.imageUrl && loc.versions.length > 0) {
        const latest = loc.versions[loc.versions.length - 1];
        loc.imageUrl = latest.imageUrl;
        loc.selectedVersionId = latest.versionId;
        modified = true;
      }
    });
  }



  if (modified) {
    store.setArtifact(projectId, 'lookdev_entities', entities);
    const scenesDir = path.join(projectDir, 'scenes');
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
    atomicWriteJsonSync(path.join(scenesDir, 'entities.json'), entities);
  }

  return entities;
}

function findMatchingEntity(oldList: any[], newEntity: any, idKey: string): any {
  if (!Array.isArray(oldList)) return undefined;
  // 1. 精确匹配 ID
  let match = oldList.find((item) => item[idKey] && item[idKey] === newEntity[idKey]);
  if (match) return match;

  // 2. 精确匹配名称
  const newName = String(newEntity.name || '').trim();
  if (newName) {
    match = oldList.find((item) => String(item.name || '').trim() === newName);
    if (match) return match;

    // 3. 包含关系与别名自愈匹配（如“纸人阿七”与“阿七”）
    match = oldList.find((item) => {
      const oldName = String(item.name || '').trim();
      if (!oldName) return false;
      return oldName.includes(newName) || newName.includes(oldName);
    });
    if (match) return match;
  }

  return undefined;
}

/**
 * 将提取的新设定与已有旧设定进行无损增量合并。
 * 若传入 targetKinds（如 ['character']），仅更新指定类别，未选中类别原样保留旧设定与已出图资产。
 */
export function mergeExtractedEntities(
  oldEntities: any,
  newEntities: any,
  targetKinds?: Array<'character' | 'location' | 'item'>
): any {
  if (!oldEntities || !oldEntities.characters) return newEntities;
  if (!newEntities || !newEntities.characters) return oldEntities;

  const allowed = Array.isArray(targetKinds) && targetKinds.length > 0 ? new Set(targetKinds) : null;
  const merged = {
    ...newEntities,
    ...(allowed && oldEntities.artStyle ? { artStyle: oldEntities.artStyle } : {}),
  };

  // 1. 合并角色资产（严格遵循 SSOT 契约：既有实体 ID 绝对不可变，未提及旧实体保护性保留）
  if (allowed && !allowed.has('character')) {
    merged.characters = oldEntities.characters || [];
  } else {
    const matchedOldCharIds = new Set<string>();
    const updatedChars = (newEntities.characters || []).map((newChar: any) => {
      const oldChar = findMatchingEntity(oldEntities.characters || [], newChar, 'characterId');
      if (!oldChar) return newChar;

      if (oldChar.characterId) matchedOldCharIds.add(oldChar.characterId);
      return {
        ...newChar,
        // 核心铁律：实体 ID 绝对不可变，严格继承既有旧 ID，杜绝后序重提背刺分镜
        characterId: oldChar.characterId,
        name: oldChar.name && oldChar.name.length >= (newChar.name?.length || 0) ? oldChar.name : newChar.name,
        imageUrl: oldChar.imageUrl || newChar.imageUrl,
        versions:
          oldChar.versions && oldChar.versions.length > 0
            ? oldChar.versions
            : newChar.versions || [],
        selectedVersionId:
          oldChar.selectedVersionId || newChar.selectedVersionId,
        referenceImageUrl:
          oldChar.referenceImageUrl || newChar.referenceImageUrl,
        // 若原先编辑过提示词，优先保留
        promptZh: oldChar.promptZh || newChar.promptZh,
      };
    });

    const unmentionedOldChars = (oldEntities.characters || []).filter(
      (c: any) => c.characterId && !matchedOldCharIds.has(c.characterId)
    );
    merged.characters = [...updatedChars, ...unmentionedOldChars];
  }

  // 2. 合并场景资产（严格遵循 SSOT 契约：既有场景 ID 绝对不可变，未提及场景保护性保留）
  if (allowed && !allowed.has('location')) {
    merged.locations = oldEntities.locations || [];
  } else {
    const matchedOldLocIds = new Set<string>();
    const updatedLocs = (newEntities.locations || []).map((newLoc: any) => {
      const oldLoc = findMatchingEntity(oldEntities.locations || [], newLoc, 'locationId');
      if (!oldLoc) return newLoc;

      if (oldLoc.locationId) matchedOldLocIds.add(oldLoc.locationId);
      return {
        ...newLoc,
        // 核心铁律：实体 ID 绝对不可变，严格继承既有旧 ID
        locationId: oldLoc.locationId,
        name: oldLoc.name && oldLoc.name.length >= (newLoc.name?.length || 0) ? oldLoc.name : newLoc.name,
        imageUrl: oldLoc.imageUrl || newLoc.imageUrl,
        versions:
          oldLoc.versions && oldLoc.versions.length > 0
            ? oldLoc.versions
            : newLoc.versions || [],
        selectedVersionId:
          oldLoc.selectedVersionId || newLoc.selectedVersionId,
        referenceImageUrl:
          oldLoc.referenceImageUrl || newLoc.referenceImageUrl,
        promptZh: oldLoc.promptZh || newLoc.promptZh,
      };
    });

    const unmentionedOldLocs = (oldEntities.locations || []).filter(
      (l: any) => l.locationId && !matchedOldLocIds.has(l.locationId)
    );
    merged.locations = [...updatedLocs, ...unmentionedOldLocs];
  }

  // 3. 合并道具资产（保留已有特写图、参考底图与高清超分版本库，严格保持既有道具 ID 不可变）
  if (allowed && !allowed.has('item')) {
    merged.items = oldEntities.items || [];
  } else {
    const matchedOldItemIds = new Set<string>();
    const updatedItems = (newEntities.items || []).map((newItem: any) => {
      const oldItem = findMatchingEntity(oldEntities.items || [], newItem, 'itemId') ||
        findMatchingEntity(oldEntities.items || [], newItem, 'id');
      if (!oldItem) return newItem;

      const effectiveId = oldItem.itemId || oldItem.id;
      if (effectiveId) matchedOldItemIds.add(effectiveId);
      return {
        ...newItem,
        // 核心铁律：实体 ID 绝对不可变，严格继承既有旧 ID
        itemId: effectiveId,
        name: oldItem.name && oldItem.name.length >= (newItem.name?.length || 0) ? oldItem.name : newItem.name,
        imageUrl: oldItem.imageUrl || newItem.imageUrl,
        versions:
          oldItem.versions && oldItem.versions.length > 0
            ? oldItem.versions
            : newItem.versions || [],
        selectedVersionId:
          oldItem.selectedVersionId || newItem.selectedVersionId,
        referenceImageUrl:
          oldItem.referenceImageUrl || newItem.referenceImageUrl,
        promptZh: oldItem.promptZh || newItem.promptZh,
      };
    });

    const unmentionedOldItems = (oldEntities.items || []).filter((i: any) => {
      const id = i.itemId || i.id;
      return id && !matchedOldItemIds.has(id);
    });
    merged.items = [...updatedItems, ...unmentionedOldItems];
  }

  return merged;
}
