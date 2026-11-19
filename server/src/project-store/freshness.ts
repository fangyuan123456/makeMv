/**
 * project-store/freshness.ts
 * 上游变更 ➔ 下游脏状态追踪账本 (Artifact Freshness & Stale Lineage SSOT)
 *
 * 追踪链路：
 * 1. 剧本正文修订 ➔ PRD 拓扑标脏
 * 2. PRD 重拆 ➔ 受影响分幕分镜标脏
 * 3. 角色/场景/道具定妆重绘、超分或切换版本 ➔ 仅引用该实体的已出图镜头关键帧标脏
 * 4. 镜头首/末帧重绘或超分 ➔ 仅该镜头的已生成视频标脏
 */

import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from './ProjectStore.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../utils/atomicFile.js';

export type EntityKind = 'character' | 'location' | 'item';

export interface ArtifactFreshnessLedger {
  screenplayUpdatedAt?: number;
  prdUpdatedAt?: number;
  prdSourceScreenplayAt?: number;
  entitiesUpdatedAt: Record<string, { updatedAt: number; label: string; kind: EntityKind }>;
  clipsStoryboard: Record<string, { updatedAt: number; sourcePrdAt?: number }>;
  shotsKeyframe: Record<
    string,
    {
      firstUpdatedAt?: number;
      lastUpdatedAt?: number;
      sourceEntities?: Record<string, number>;
    }
  >;
  shotsVideo: Record<
    string,
    {
      updatedAt: number;
      sourceFirstAt?: number;
      sourceLastAt?: number;
    }
  >;
}

export interface StaleEntry {
  reason: string;
  updatedAt: number;
}

export interface ProjectStaleMap {
  prd?: StaleEntry;
  clips: Record<string, StaleEntry>;
  shotKeyframes: Record<string, StaleEntry>;
  shotVideos: Record<string, StaleEntry>;
}

function createEmptyLedger(): ArtifactFreshnessLedger {
  return {
    entitiesUpdatedAt: {},
    clipsStoryboard: {},
    shotsKeyframe: {},
    shotsVideo: {},
  };
}

function getLedgerPath(projectId: string): string {
  const store = ProjectStore.getInstance();
  return path.join(store.getProjectDir(projectId), 'freshness.json');
}

export function readFreshnessLedger(projectId: string): ArtifactFreshnessLedger {
  const filePath = getLedgerPath(projectId);
  if (!fs.existsSync(filePath)) return createEmptyLedger();
  const raw = safeReadJsonSync<Partial<ArtifactFreshnessLedger>>(filePath);
  if (!raw || typeof raw !== 'object') return createEmptyLedger();
  return {
    screenplayUpdatedAt: raw.screenplayUpdatedAt,
    prdUpdatedAt: raw.prdUpdatedAt,
    prdSourceScreenplayAt: raw.prdSourceScreenplayAt,
    entitiesUpdatedAt: raw.entitiesUpdatedAt || {},
    clipsStoryboard: raw.clipsStoryboard || {},
    shotsKeyframe: raw.shotsKeyframe || {},
    shotsVideo: raw.shotsVideo || {},
  };
}

function saveFreshnessLedger(projectId: string, ledger: ArtifactFreshnessLedger): void {
  const filePath = getLedgerPath(projectId);
  atomicWriteJsonSync(filePath, ledger);
}

function getProjectStoryboardClips(projectId: string): any[] {
  const store = ProjectStore.getInstance();
  const storyboards = store.getArtifact<any[]>(projectId, 'storyboards');
  if (Array.isArray(storyboards) && storyboards.length > 0) return storyboards;
  const filmSpec = store.getArtifact<any>(projectId, 'film_spec');
  if (Array.isArray(filmSpec?.clips)) return filmSpec.clips;
  return [];
}

function buildCurrentEntityTimestamps(ledger: ArtifactFreshnessLedger): Record<string, number> {
  const snapshot: Record<string, number> = {};
  for (const [id, info] of Object.entries(ledger.entitiesUpdatedAt)) {
    snapshot[id] = info.updatedAt;
  }
  return snapshot;
}

/** 剧本正文生成或局部修订后记账 */
export function recordScreenplayUpdated(projectId: string): void {
  const store = ProjectStore.getInstance();
  const ledger = readFreshnessLedger(projectId);
  const now = Date.now();
  ledger.screenplayUpdatedAt = now;

  // 若已有 PRD 且此前未建基线，回填旧基线以便立即标记 PRD 过期
  const prd = store.getArtifact<any>(projectId, 'prd');
  if (prd && (prd.clips?.length > 0 || prd.scenes?.length > 0) && !ledger.prdSourceScreenplayAt) {
    ledger.prdSourceScreenplayAt = now - 1;
  }
  saveFreshnessLedger(projectId, ledger);
}

/** PRD 重新拆解落盘后记账（自动清除 PRD 自身脏态） */
export function recordPrdUpdated(projectId: string): void {
  const ledger = readFreshnessLedger(projectId);
  const now = Date.now();
  ledger.prdUpdatedAt = now;
  ledger.prdSourceScreenplayAt = Math.max(now, ledger.screenplayUpdatedAt || 0);

  // 为已有分镜但未建基线的分幕补记旧基线，确保 PRD 变更后可感知过期
  const clips = getProjectStoryboardClips(projectId);
  for (const clip of clips) {
    const cid = clip?.clipId || clip?.id;
    if (!cid || !Array.isArray(clip?.shots) || clip.shots.length === 0) continue;
    if (!ledger.clipsStoryboard[cid]) {
      ledger.clipsStoryboard[cid] = { updatedAt: now - 1, sourcePrdAt: now - 1 };
    }
  }
  saveFreshnessLedger(projectId, ledger);
}

/** 视觉定妆实体出图、超分或切换版本后记账 */
export function recordEntityUpdated(
  projectId: string,
  entity: { kind: EntityKind; id: string; label?: string }
): void {
  if (!entity.id) return;
  const ledger = readFreshnessLedger(projectId);
  const now = Date.now();

  // 为已出图但尚无关键帧基线的镜头补记旧基线，避免老项目漏标脏
  const clips = getProjectStoryboardClips(projectId);
  for (const clip of clips) {
    for (const shot of clip?.shots || []) {
      const sid = shot?.shotId || shot?.id;
      const hasKf = Boolean(shot?.firstFrameImageUrl || shot?.keyframeUrl || shot?.lastFrameImageUrl);
      if (sid && hasKf && !ledger.shotsKeyframe[sid]) {
        ledger.shotsKeyframe[sid] = {
          firstUpdatedAt: now - 1,
          sourceEntities: { [entity.id]: now - 1 },
        };
      }
    }
  }

  ledger.entitiesUpdatedAt[entity.id] = {
    updatedAt: now,
    label: entity.label || entity.id,
    kind: entity.kind,
  };
  saveFreshnessLedger(projectId, ledger);
}

/** 分幕分镜拆解完成后记账（自动清除该分幕脏态） */
export function recordStoryboardUpdated(projectId: string, clipIds: string[]): void {
  const ledger = readFreshnessLedger(projectId);
  const now = Date.now();
  const prdStamp = Math.max(now, ledger.prdUpdatedAt || 0);
  for (const cid of clipIds) {
    if (!cid) continue;
    ledger.clipsStoryboard[cid] = { updatedAt: now, sourcePrdAt: prdStamp };
  }
  saveFreshnessLedger(projectId, ledger);
}

/** 镜头关键帧生成或超分后记账（清除该镜头关键帧脏态，并使该镜头已有旧视频标脏） */
export function recordShotKeyframeUpdated(
  projectId: string,
  shotId: string,
  frame: 'first' | 'last' | 'both' = 'first'
): void {
  if (!shotId) return;
  const ledger = readFreshnessLedger(projectId);
  const now = Date.now();

  // 若该镜头已有视频但未建基线，补记旧基线使旧视频标脏
  const clips = getProjectStoryboardClips(projectId);
  for (const clip of clips) {
    const matched = (clip?.shots || []).find((s: any) => (s?.shotId || s?.id) === shotId);
    if (matched?.videoUrl && !ledger.shotsVideo[shotId]) {
      ledger.shotsVideo[shotId] = {
        updatedAt: now - 1,
        sourceFirstAt: now - 1,
        sourceLastAt: now - 1,
      };
    }
  }

  const prev = ledger.shotsKeyframe[shotId] || {};
  ledger.shotsKeyframe[shotId] = {
    ...prev,
    ...(frame === 'first' || frame === 'both' ? { firstUpdatedAt: now } : {}),
    ...(frame === 'last' || frame === 'both' ? { lastUpdatedAt: now } : {}),
    sourceEntities: buildCurrentEntityTimestamps(ledger),
  };
  saveFreshnessLedger(projectId, ledger);
}

/** 镜头动态视频生成后记账（自动清除该镜头视频脏态） */
export function recordShotVideoUpdated(projectId: string, shotId: string): void {
  if (!shotId) return;
  const ledger = readFreshnessLedger(projectId);
  const now = Date.now();
  const kf = ledger.shotsKeyframe[shotId];
  ledger.shotsVideo[shotId] = {
    updatedAt: now,
    sourceFirstAt: Math.max(now, kf?.firstUpdatedAt || 0),
    sourceLastAt: Math.max(now, kf?.lastUpdatedAt || 0),
  };
  saveFreshnessLedger(projectId, ledger);
}

function shotReferencesEntity(
  clip: any,
  shot: any,
  entityId: string,
  entityLabel: string,
  kind: EntityKind
): boolean {
  const idLower = entityId.toLowerCase();
  const labelLower = entityLabel.trim().toLowerCase();
  const matchesToken = (val: unknown): boolean => {
    if (typeof val !== 'string') return false;
    const s = val.trim().toLowerCase();
    return Boolean(s && (s === idLower || (labelLower && (s === labelLower || s.includes(labelLower)))));
  };

  if (kind === 'character') {
    const list: any[] = Array.isArray(shot?.characters) ? shot.characters : [];
    return list.some(matchesToken);
  }
  if (kind === 'item') {
    const list: any[] = Array.isArray(shot?.items) ? shot.items : [];
    return list.some(matchesToken);
  }
  if (kind === 'location') {
    return (
      matchesToken(shot?.locationId) ||
      matchesToken(shot?.location) ||
      matchesToken(clip?.locationId) ||
      matchesToken(clip?.location)
    );
  }
  return false;
}

const KIND_ZH: Record<EntityKind, string> = {
  character: '角色',
  location: '场景',
  item: '道具',
};

/**
 * 实时计算当前项目的全链路脏资产表 (ProjectStaleMap)
 */
export function computeProjectStaleMap(projectId: string): ProjectStaleMap {
  const store = ProjectStore.getInstance();
  const ledger = readFreshnessLedger(projectId);
  const staleMap: ProjectStaleMap = {
    clips: {},
    shotKeyframes: {},
    shotVideos: {},
  };

  // 1. 剧本 ➔ PRD
  const prd = store.getArtifact<any>(projectId, 'prd');
  const hasPrd = Boolean(prd && (prd.clips?.length > 0 || prd.scenes?.length > 0));
  if (
    hasPrd &&
    ledger.screenplayUpdatedAt &&
    ledger.prdSourceScreenplayAt &&
    ledger.screenplayUpdatedAt > ledger.prdSourceScreenplayAt
  ) {
    staleMap.prd = {
      reason: '上游剧本正文已修订，建议重新解析 PRD 以同步设定与命名',
      updatedAt: ledger.screenplayUpdatedAt,
    };
  }

  const clips = getProjectStoryboardClips(projectId);
  const entityEntries = Object.entries(ledger.entitiesUpdatedAt);

  for (const clip of clips) {
    const clipId = clip?.clipId || clip?.id;
    const shots: any[] = Array.isArray(clip?.shots) ? clip.shots : [];
    if (!clipId) continue;

    // 2. PRD ➔ 分幕分镜
    const clipRecord = ledger.clipsStoryboard[clipId];
    if (
      shots.length > 0 &&
      ledger.prdUpdatedAt &&
      clipRecord?.sourcePrdAt &&
      ledger.prdUpdatedAt > clipRecord.sourcePrdAt
    ) {
      staleMap.clips[clipId] = {
        reason: '上游 PRD 拓扑已更新，本幕分镜可能与最新剧情不同步',
        updatedAt: ledger.prdUpdatedAt,
      };
    }

    for (const shot of shots) {
      const shotId = shot?.shotId || shot?.id;
      if (!shotId) continue;

      const hasKf = Boolean(shot.firstFrameImageUrl || shot.keyframeUrl || shot.lastFrameImageUrl);
      const kfRecord = ledger.shotsKeyframe[shotId];

      // 3. 定妆实体 ➔ 镜头关键帧
      if (hasKf && kfRecord && entityEntries.length > 0) {
        const changedLabels: string[] = [];
        let latestEntityTs = 0;
        for (const [eid, info] of entityEntries) {
          if (!shotReferencesEntity(clip, shot, eid, info.label, info.kind)) continue;
          const baseTs =
            kfRecord.sourceEntities?.[eid] ??
            Math.max(kfRecord.firstUpdatedAt || 0, kfRecord.lastUpdatedAt || 0);
          if (info.updatedAt > baseTs) {
            changedLabels.push(`${KIND_ZH[info.kind]}【${info.label}】`);
            latestEntityTs = Math.max(latestEntityTs, info.updatedAt);
          }
        }
        if (changedLabels.length > 0) {
          staleMap.shotKeyframes[shotId] = {
            reason: `上游定妆已变更（${changedLabels.join('、')}），建议重绘本镜关键帧`,
            updatedAt: latestEntityTs,
          };
        }
      }

      // 4. 镜头关键帧 ➔ 镜头视频
      const vidRecord = ledger.shotsVideo[shotId];
      if (shot.videoUrl && kfRecord && vidRecord) {
        const firstNewer = Boolean(
          kfRecord.firstUpdatedAt &&
            vidRecord.sourceFirstAt !== undefined &&
            kfRecord.firstUpdatedAt > vidRecord.sourceFirstAt
        );
        const lastNewer = Boolean(
          kfRecord.lastUpdatedAt &&
            vidRecord.sourceLastAt !== undefined &&
            kfRecord.lastUpdatedAt > vidRecord.sourceLastAt
        );
        if (firstNewer || lastNewer) {
          const which = firstNewer && lastNewer ? '首帧与末帧' : firstNewer ? '首帧' : '末帧';
          staleMap.shotVideos[shotId] = {
            reason: `上游${which}关键帧已更新，建议重新渲染本镜视频`,
            updatedAt: Math.max(kfRecord.firstUpdatedAt || 0, kfRecord.lastUpdatedAt || 0),
          };
        }
      }
    }
  }

  return staleMap;
}
