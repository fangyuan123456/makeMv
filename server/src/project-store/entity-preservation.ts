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

export function hydrateEntitiesWithDiskAssets(
  projectId: string,
  projectDir: string,
  entities: any
): any {
  if (!entities) return entities;
  let modified = false;
  const store = ProjectStore.getInstance();

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
        const versionMatch = file.match(/_v_(\d+)\./);
        const versionId = versionMatch
          ? `v_${versionMatch[1]}`
          : `v_${file.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const createdAt = versionMatch
          ? new Date(Number(versionMatch[1])).toISOString()
          : new Date().toISOString();

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
        const versionMatch = file.match(/_v_(\d+)\./);
        const versionId = versionMatch
          ? `v_${versionMatch[1]}`
          : `v_${file.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const createdAt = versionMatch
          ? new Date(Number(versionMatch[1])).toISOString()
          : new Date().toISOString();

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

/**
 * 将提取的新设定与已有旧设定进行无损增量合并
 */
export function mergeExtractedEntities(
  oldEntities: any,
  newEntities: any
): any {
  if (!oldEntities || !oldEntities.characters) return newEntities;
  if (!newEntities || !newEntities.characters) return oldEntities;

  const merged = { ...newEntities };

  // 1. 合并角色资产
  merged.characters = (newEntities.characters || []).map((newChar: any) => {
    const oldChar = (oldEntities.characters || []).find(
      (c: any) =>
        c.characterId === newChar.characterId || c.name === newChar.name
    );
    if (!oldChar) return newChar;

    return {
      ...newChar,
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

  // 2. 合并场景资产
  merged.locations = (newEntities.locations || []).map((newLoc: any) => {
    const oldLoc = (oldEntities.locations || []).find(
      (l: any) =>
        l.locationId === newLoc.locationId || l.name === newLoc.name
    );
    if (!oldLoc) return newLoc;

    return {
      ...newLoc,
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

  return merged;
}
