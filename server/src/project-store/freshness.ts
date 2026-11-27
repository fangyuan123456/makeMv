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
import crypto from 'node:crypto';
import { ProjectStore } from './ProjectStore.js';
import { TaskStore } from '../task-engine/task-store.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../utils/atomicFile.js';

export type EntityKind = 'character' | 'location' | 'item';

/** 规范化计算镜头生图提示词指纹（过滤空白差异，以内容真值为唯一准则） */
export function computePromptFingerprint(text: unknown): string {
  if (typeof text !== 'string') return '';
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/** 提取镜头首帧有效提示词（单一事实来源） */
export function getShotFirstFramePrompt(shot: any): string {
  if (!shot || typeof shot !== 'object') return '';
  return (
    shot.firstFramePrompt ||
    shot.prompt ||
    shot.promptZh ||
    shot.description ||
    ''
  ).trim();
}

export interface ArtifactFreshnessLedger {
  screenplayUpdatedAt?: number;
  prdUpdatedAt?: number;
  prdSourceScreenplayAt?: number;
  entitiesUpdatedAt: Record<string, { updatedAt: number; label: string; kind: EntityKind; sourceSpecAt?: number }>;
  entitySpecsUpdatedAt?: Record<string, { updatedAt: number; label: string; kind: EntityKind }>;
  clipsStoryboard: Record<string, { updatedAt: number; sourcePrdAt?: number }>;
  shotsPrompt?: Record<string, { updatedAt: number; sourcePrdAt?: number; promptHash?: string }>;
  shotsKeyframe: Record<
    string,
    {
      firstUpdatedAt?: number;
      lastUpdatedAt?: number;
      sourceEntities?: Record<string, number>;
      sourcePromptAt?: number;
      sourcePromptHash?: string;
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
  entities: Record<string, StaleEntry & { kind: EntityKind; label: string }>;
  clips: Record<string, StaleEntry>;
  shotKeyframes: Record<string, StaleEntry>;
  shotVideos: Record<string, StaleEntry>;
}

function createEmptyLedger(): ArtifactFreshnessLedger {
  return {
    entitiesUpdatedAt: {},
    entitySpecsUpdatedAt: {},
    clipsStoryboard: {},
    shotsPrompt: {},
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
    entitySpecsUpdatedAt: raw.entitySpecsUpdatedAt || {},
    clipsStoryboard: raw.clipsStoryboard || {},
    shotsPrompt: raw.shotsPrompt || {},
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
      const hasKf = Boolean(shot?.firstFrameImageUrl || shot?.lastFrameImageUrl);
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
    sourceSpecAt: now,
  };
  saveFreshnessLedger(projectId, ledger);
}

/** 实体设定文本（提炼/修改）更新后记账 */
export function recordEntitySpecUpdated(
  projectId: string,
  entity: { kind: EntityKind; id: string; label?: string }
): void {
  if (!entity.id) return;
  const ledger = readFreshnessLedger(projectId);
  const now = Date.now();
  if (!ledger.entitySpecsUpdatedAt) ledger.entitySpecsUpdatedAt = {};
  ledger.entitySpecsUpdatedAt[entity.id] = {
    updatedAt: now,
    label: entity.label || entity.id,
    kind: entity.kind,
  };
  saveFreshnessLedger(projectId, ledger);
}

/** 批量更新实体设定（资产提取完成后全量记账） */
export function recordAllEntitySpecsUpdated(
  projectId: string,
  entities: Array<{ kind: EntityKind; id: string; label?: string }>
): void {
  if (!Array.isArray(entities) || entities.length === 0) return;
  const ledger = readFreshnessLedger(projectId);
  const now = Date.now();
  if (!ledger.entitySpecsUpdatedAt) ledger.entitySpecsUpdatedAt = {};
  for (const entity of entities) {
    if (!entity.id) continue;
    ledger.entitySpecsUpdatedAt[entity.id] = {
      updatedAt: now,
      label: entity.label || entity.id,
      kind: entity.kind,
    };
  }
  saveFreshnessLedger(projectId, ledger);
}

/** 分幕分镜拆解完成后记账（自动清除该分幕脏态） */
export function recordStoryboardUpdated(projectId: string, clipIds: string[]): void {
  const ledger = readFreshnessLedger(projectId);
  const now = Date.now();
  const prdStamp = Math.max(now, ledger.screenplayUpdatedAt || 0, ledger.prdUpdatedAt || 0);
  for (const cid of clipIds) {
    if (!cid) continue;
    ledger.clipsStoryboard[cid] = { updatedAt: now, sourcePrdAt: prdStamp };
  }
  saveFreshnessLedger(projectId, ledger);
}

/** 镜头台本/提示词生成或定向修改后记账（若已有关键帧，使其标脏） */
export function recordShotPromptUpdated(
  projectId: string,
  shotIds: string[],
  shotPrompts?: Record<string, string>
): void {
  if (!shotIds.length) return;
  const ledger = readFreshnessLedger(projectId);
  const now = Date.now();
  const prdStamp = Math.max(now, ledger.screenplayUpdatedAt || 0, ledger.prdUpdatedAt || 0);
  if (!ledger.shotsPrompt) ledger.shotsPrompt = {};

  // 为已有关键帧但尚无提示词基线的镜头补记旧基线，确保修改后可感知过期
  const clips = getProjectStoryboardClips(projectId);
  for (const clip of clips) {
    for (const shot of clip?.shots || []) {
      const sid = shot?.shotId || shot?.id;
      const hasKf = Boolean(shot?.firstFrameImageUrl || shot?.lastFrameImageUrl);
      if (sid && hasKf && shotIds.includes(sid)) {
        const shotPrompt = shotPrompts?.[sid] || getShotFirstFramePrompt(shot);
        const pHash = computePromptFingerprint(shotPrompt);
        if (!ledger.shotsKeyframe[sid]) {
          ledger.shotsKeyframe[sid] = {
            firstUpdatedAt: now - 1,
            sourcePromptAt: now - 1,
            sourcePromptHash: pHash,
          };
        } else if (ledger.shotsKeyframe[sid].sourcePromptAt === undefined) {
          ledger.shotsKeyframe[sid].sourcePromptAt = ledger.shotsKeyframe[sid].firstUpdatedAt || (now - 1);
        }
      }
    }
  }

  for (const sid of shotIds) {
    if (!sid) continue;
    let currentText = shotPrompts?.[sid];
    if (currentText === undefined) {
      for (const clip of clips) {
        const matched = (clip?.shots || []).find((s: any) => (s?.shotId || s?.id) === sid);
        if (matched) {
          currentText = getShotFirstFramePrompt(matched);
          break;
        }
      }
    }
    const currentHash = computePromptFingerprint(currentText);
    const existing = ledger.shotsPrompt[sid];

    // 百分百源头治理：如果已有指纹且本次提示词文本指纹完全一致（一字未动），坚决不刷新 updatedAt！
    if (existing && existing.promptHash && currentHash && existing.promptHash === currentHash) {
      continue;
    }

    ledger.shotsPrompt[sid] = {
      updatedAt: now,
      sourcePrdAt: prdStamp,
      ...(currentHash ? { promptHash: currentHash } : {}),
    };
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
  const promptRecord = ledger.shotsPrompt?.[shotId];

  // 抓取当前出图使用的实际提示词指纹
  let promptHash = promptRecord?.promptHash;
  if (!promptHash) {
    for (const clip of clips) {
      const matched = (clip?.shots || []).find((s: any) => (s?.shotId || s?.id) === shotId);
      if (matched) {
        promptHash = computePromptFingerprint(getShotFirstFramePrompt(matched));
        break;
      }
    }
  }

  // 首帧出图成功后，基线时间戳对齐，彻底清除提示词脏态
  const effectivePromptTs = Math.max(now, promptRecord?.updatedAt || 0);
  if (promptRecord) {
    promptRecord.updatedAt = effectivePromptTs;
    if (promptHash) promptRecord.promptHash = promptHash;
  }

  ledger.shotsKeyframe[shotId] = {
    ...prev,
    ...(frame === 'first' || frame === 'both' ? { firstUpdatedAt: now } : {}),
    ...(frame === 'last' || frame === 'both' ? { lastUpdatedAt: now } : {}),
    sourceEntities: buildCurrentEntityTimestamps(ledger),
    sourcePromptAt: effectivePromptTs,
    sourcePromptHash: promptHash || prev.sourcePromptHash,
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
    entities: {},
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

  // 1.5 实体设定更新 ➔ 定妆图标脏
  const entitiesArtifact = store.getArtifact<any>(projectId, 'lookdev_entities');
  const allEntitiesList = [
    ...(entitiesArtifact?.characters || []).map((c: any) => ({ ...c, kind: 'character' as EntityKind, id: c.characterId || c.id })),
    ...(entitiesArtifact?.locations || []).map((l: any) => ({ ...l, kind: 'location' as EntityKind, id: l.locationId || l.id })),
    ...(entitiesArtifact?.items || []).map((i: any) => ({ ...i, kind: 'item' as EntityKind, id: i.itemId || i.id })),
  ];

  if (ledger.entitySpecsUpdatedAt) {
    for (const ent of allEntitiesList) {
      if (!ent.id) continue;
      const specRecord = ledger.entitySpecsUpdatedAt[ent.id];
      const imgRecord = ledger.entitiesUpdatedAt[ent.id];
      const hasImage = Boolean(ent.imageUrl);
      if (hasImage && specRecord) {
        const baseImgTs = imgRecord?.sourceSpecAt ?? imgRecord?.updatedAt ?? 0;
        if (specRecord.updatedAt > baseImgTs) {
          staleMap.entities[ent.id] = {
            reason: `${KIND_ZH[specRecord.kind]}【${specRecord.label || ent.name}】设定已重新提炼或修改，当前定妆图为旧版，建议按新设定重新定妆出图`,
            updatedAt: specRecord.updatedAt,
            kind: specRecord.kind,
            label: specRecord.label || ent.name || ent.id,
          };
        }
      }
    }
  }

  const clips = getProjectStoryboardClips(projectId);
  const entityEntries = Object.entries(ledger.entitiesUpdatedAt);

  for (const clip of clips) {
    const clipId = clip?.clipId || clip?.id;
    const shots: any[] = Array.isArray(clip?.shots) ? clip.shots : [];
    if (!clipId) continue;

    // 2. 结构化剧本 / PRD ➔ 分幕分镜
    const clipRecord = ledger.clipsStoryboard[clipId];
    const upstreamStoryAt = Math.max(ledger.screenplayUpdatedAt || 0, ledger.prdUpdatedAt || 0);
    if (
      shots.length > 0 &&
      upstreamStoryAt > 0 &&
      clipRecord?.sourcePrdAt &&
      upstreamStoryAt > clipRecord.sourcePrdAt
    ) {
      staleMap.clips[clipId] = {
        reason: '上游剧本已更新，本幕分镜可能与最新剧情不同步',
        updatedAt: upstreamStoryAt,
      };
    }

    for (const shot of shots) {
      const shotId = shot?.shotId || shot?.id;
      if (!shotId) continue;

      const hasKf = Boolean(shot.firstFrameImageUrl || shot.lastFrameImageUrl);
      const kfRecord = ledger.shotsKeyframe[shotId];

      // 3-A. 镜头视听提示词变更 ➔ 镜头关键帧标脏
      const promptRecord = ledger.shotsPrompt?.[shotId];
      if (hasKf && kfRecord && promptRecord) {
        const currentShotPrompt = getShotFirstFramePrompt(shot);
        const currentHash = computePromptFingerprint(currentShotPrompt);

        // 源头治理：若出图时记录了提示词指纹，且与当前提示词文本指纹完全相同（一字未改），坚决不标脏；
        // 严禁在此处将修改后的 currentHash 赋给 kfRecord.sourcePromptHash 造成假收敛！
        const isContentIdentical = Boolean(
          kfRecord.sourcePromptHash &&
          currentHash &&
          kfRecord.sourcePromptHash === currentHash
        );

        if (!isContentIdentical) {
          const basePromptTs =
            kfRecord.sourcePromptAt ??
            Math.max(kfRecord.firstUpdatedAt || 0, kfRecord.lastUpdatedAt || 0);
          if (promptRecord.updatedAt > basePromptTs) {
            staleMap.shotKeyframes[shotId] = {
              reason: '镜头视听提示词已修改，建议重新渲染首帧关键帧以呈现最新设定',
              updatedAt: promptRecord.updatedAt,
            };
          }
        }
      }

      // 3-B. 定妆实体 ➔ 镜头关键帧 (若提示词未标脏则检测定妆变更)
      if (hasKf && kfRecord && entityEntries.length > 0 && !staleMap.shotKeyframes[shotId]) {
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

      // 4. 镜头关键帧 / 运镜提示词 ➔ 镜头视频标脏 (源头全链路闭环)
      const vidRecord = ledger.shotsVideo[shotId];
      if (shot.videoUrl && vidRecord) {
        // 4-A. 运镜提示词变更 ➔ 视频标脏
        if (promptRecord && promptRecord.updatedAt > vidRecord.updatedAt) {
          staleMap.shotVideos[shotId] = {
            reason: '镜头运镜提示词已修改，建议重新渲染本镜视频以呈现最新动态',
            updatedAt: promptRecord.updatedAt,
          };
        } else if (kfRecord) {
          // 4-B. 关键帧更新 ➔ 视频标脏
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
  }

  return staleMap;
}

/**
 * 统一工程上下游资产脏数据态势感知文本渲染器（Stale Data Prompt SSOT）
 * 基于通用实体键与活跃任务输入动态感知自愈状态（零业务与工具名硬编码），渲染为统一的提示词引导区块
 */
export function renderProjectStaleSummary(projectId: string): string {
  if (!projectId) return '';
  const staleMap = computeProjectStaleMap(projectId);
  const lines: string[] = [];

  // 获取当前正在执行（running / pending）的物理任务，排除正在自愈中的实体，严防模型在执行期间重复提案
  const activeTasks = TaskStore.getInstance()
    .getTasksByProject(projectId)
    .filter((t) => t.status === 'running' || t.status === 'pending');

  // 通用实体活跃判定器（零工具名硬编码，基于入参关联的物理实体标的动态计算）
  const isEntityTargetActive = (entityId: string) =>
    activeTasks.some((t) => {
      const inp = t.input || {};
      return (
        inp.targetId === entityId ||
        inp.characterId === entityId ||
        inp.locationId === entityId ||
        inp.itemId === entityId
      );
    });

  const isShotTargetActive = (shotId: string) =>
    activeTasks.some((t) => {
      const inp = t.input || {};
      return inp.shotId === shotId || inp.targetId === shotId;
    });

  const isClipTargetActive = (clipId: string) =>
    activeTasks.some((t) => {
      const inp = t.input || {};
      return inp.clipId === clipId;
    });

  const isProjectWideTaskActive = () =>
    activeTasks.some((t) => {
      const inp = t.input || {};
      // 未绑定具体局部实体的全局项目级任务
      return !inp.targetId && !inp.shotId && !inp.clipId && !inp.characterId && !inp.locationId && !inp.itemId;
    });

  if (staleMap.prd && !isProjectWideTaskActive()) {
    lines.push(`- 剧本与策划案同步：⚠ ${staleMap.prd.reason}`);
  }

  const staleEntities = Object.entries(staleMap.entities || {}).filter(([id]) => !isEntityTargetActive(id));
  if (staleEntities.length > 0) {
    const summary = staleEntities.map(([id, info]) => `${info.label || id}(${info.reason})`).join('；');
    lines.push(`- 视觉定妆资产已过期需重绘 (${staleEntities.length} 项)：${summary}`);
  }

  const staleClips = Object.entries(staleMap.clips || {}).filter(([id]) => !isClipTargetActive(id));
  if (staleClips.length > 0) {
    const summary = staleClips.map(([id, info]) => `${id}(${info.reason})`).join('；');
    lines.push(`- 分幕分镜台本已过期需重排 (${staleClips.length} 幕)：${summary}`);
  }

  const staleKfs = Object.entries(staleMap.shotKeyframes || {}).filter(([id]) => !isShotTargetActive(id));
  if (staleKfs.length > 0) {
    const summary = staleKfs.map(([id, info]) => `${id}(${info.reason})`).join('；');
    lines.push(`- 镜头关键帧已过期需重绘 (${staleKfs.length} 镜)：${summary}`);
  }

  const staleVids = Object.entries(staleMap.shotVideos || {}).filter(([id]) => !isShotTargetActive(id));
  if (staleVids.length > 0) {
    const summary = staleVids.map(([id, info]) => `${id}(${info.reason})`).join('；');
    lines.push(`- 镜头动态视频已过期需重渲 (${staleVids.length} 镜)：${summary}`);
  }

  if (lines.length === 0) return '';

  return `### 【当前工程上下游资产脏状态（Stale Data SSOT）】
${lines.join('\n')}
⚠ 刚性纪律：上述资产因上游设定或提示词演进已处于脏状态。当创作者提及或你在复盘中识别到脏数据时，必须直接调用 emit_director_intent(action: "propose", ...) 抛出待审自愈方案卡片供一键批准，严禁仅在正文中反问“需要我为你编排吗”！`;
}
