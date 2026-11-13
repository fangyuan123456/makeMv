/**
 * agents/film-production/steps/lookdev-render/render.ts
 * 母本资产出图实现（本工序私有，别的工序只消费它的产物、不调它）
 *
 * 三类资产，三种规矩：
 * - 角色母本：单人全身立绘，纯中性灰底，不进画面、只作参考图 → 竖版
 * - 道具母本：单件居中特写，纯中性灰底，不进画面、只作参考图 → 方形
 * - 场景母本：无人空镜，直接当游戏背景进画面 → 跟随全剧画幅
 *
 * 铁律：母本图是「可人工替换的一等资产」——磁盘已有同名文件即复用，
 * 只有显式 force 才重绘。替换后重跑本工序即可，不动任何上游数据。
 */

import path from 'path';
import fs from 'fs';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { MediaResolver } from '../../../../media/MediaResolver.js';
import { imageGenerateTool } from '../../../../tools/image-generate/image-generate.tool.js';
import { isAbortError, throwIfRunAborted } from '../../../../workflow-engine/run-context.js';
import { asyncPool } from '../../../../utils/async-pool.js';
import { config } from '../../../../utils/config.js';
import type { GlobalEntities } from '../../../../project-store/contracts/film-production/lookdev.js';

/** 角色/道具母本图统一落盘目录：全项目一份，各幕只放引用不复制二进制 */
export const ENTITY_SUBFOLDER = 'assets/entities';
/** 场景空镜母本目录：同一地点跨幕共用一张 */
export const LOCATION_SUBFOLDER = 'assets/locations';

/** 角色定妆画幅：单人立绘，与游戏画幅解耦（母本只作参考图，不进画面） */
const CHARACTER_LOOKDEV_SIZE = '768*1344';
/** 道具定妆画幅：方形特写 */
const ITEM_LOOKDEV_SIZE = '1024*1024';

const CHARACTER_LOOKDEV_NEGATIVE =
  '低分辨率，低画质，肢体畸形，手指畸形，多手多脚，画面过饱和，文字，水印，标签，边框，拼贴，分格线，多个人物，场景背景，街景，室外场景，半身裁切';

const ITEM_LOOKDEV_NEGATIVE =
  '低分辨率，低画质，文字，水印，标签，边框，拼贴，分格线，人物，手部，手指，多件物品，杂乱背景，室内街景';

/** 场景空镜的头号禁令是没有人物：一旦混进人，后续每个镜头都会把这个陌生人抄进去 */
const LOCATION_LOOKDEV_NEGATIVE =
  '人物，人像，人脸，人体，手部，背影，人群，剧情动作，文字，水印，标签，边框，拼贴，分格线，低分辨率，低画质，画面过饱和';

export interface LookdevResult {
  /** 回填了 referenceImageUrl 的实体与场景字典 */
  entities: GlobalEntities;
  rendered: number;
  reused: number;
  failed: number;
}

export function buildCharacterLookDevPrompt(
  character: GlobalEntities['characters'][number],
  artStyle: string
): string {
  const base = character.promptZh || character.appearanceSummary;
  return `角色定妆照，单人正面全身站姿，双脚着地，五官清晰：${base}。外貌细节锁定：${character.appearanceSummary}。纯中性浅灰无缝工作室背景，画面中只有这一个人，无文字无标签无水印。${artStyle}`;
}

export function buildItemLookDevPrompt(
  item: GlobalEntities['items'][number],
  artStyle: string
): string {
  const base = item.promptZh || item.appearanceSummary;
  return `关键道具定妆特写，单个完整道具居中构图，清晰展示器型、材质与纹饰细节：${base}。道具特征锁定：${item.appearanceSummary}。纯中性浅灰无缝工作室背景，无手部无人物入镜，无多余场景杂物，无文字无标签无水印。${artStyle}`;
}

export function buildLocationLookDevPrompt(
  location: GlobalEntities['locations'][number],
  artStyle: string
): string {
  const base = location.promptZh || location.appearanceSummary;
  return `空镜场景概念图，广角，画面中没有任何人物：${base}。空间布局锁定：${location.appearanceSummary}。空间氛围与光线：${location.atmosphere}。只有空间、建筑结构、陈设与光影，无人物无人体局部无背影，无文字无标签无水印。${artStyle}`;
}

interface AssetRenderStat {
  rendered: boolean;
  failed: boolean;
}

async function renderOne(
  projectId: string,
  id: string,
  prompt: string,
  negativePrompt: string,
  size: string,
  existingFiles: string[],
  force: boolean,
  target: { subfolder: string; mode: 'character_t2i' | 'general_t2i' }
): Promise<{ url?: string; path?: string; stat: AssetRenderStat }> {
  const cachedFile = existingFiles.find((f) => f.startsWith(`${id}.`));
  const cachedUrl = cachedFile
    ? MediaResolver.toMediaUrl(projectId, target.subfolder, cachedFile)
    : undefined;

  if (cachedUrl && !force) {
    return {
      url: cachedUrl,
      path: `${target.subfolder}/${cachedFile}`,
      stat: { rendered: false, failed: false },
    };
  }

  try {
    const res = await (imageGenerateTool.execute as any)({
      context: {
        projectId,
        prompt,
        negativePrompt,
        mode: target.mode,
        size,
        subfolder: target.subfolder,
        customFilename: id,
      },
    });
    if (res?.success && res?.mediaUrl) {
      const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
      const relPath = res.diskPath
        ? path.relative(projectDir, res.diskPath).split(path.sep).join('/')
        : undefined;
      return {
        url: res.mediaUrl,
        path: relPath,
        stat: { rendered: true, failed: false },
      };
    }
    console.warn(`[LookDev] 资产 [${id}] 出图未返回落盘文件，视为失败`);
  } catch (err) {
    if (isAbortError(err)) throw err;
    console.warn(`[LookDev] 资产 [${id}] 出图失败:`, err);
  }

  // 失败时保留旧图（若有），不能把已经能用的母本踢掉
  return { url: cachedUrl, stat: { rendered: false, failed: true } };
}

/**
 * 为全部角色、道具与场景生成（或复用）母本图，并把 /media/... URL 回填进字典。
 * 同时落 scenes/lookdev.json —— 母本台账的唯一写入口。
 */
export async function renderLookdev(
  projectId: string,
  entities: GlobalEntities,
  options: { force?: boolean; concurrency?: number } = {}
): Promise<LookdevResult> {
  const { force = false, concurrency = 4 } = options;
  const projectDir = ProjectStore.getInstance().getProjectDir(projectId);

  const entityDir = path.resolve(projectDir, ENTITY_SUBFOLDER);
  const locationDir = path.resolve(projectDir, LOCATION_SUBFOLDER);
  fs.mkdirSync(entityDir, { recursive: true });
  fs.mkdirSync(locationDir, { recursive: true });
  const entityFiles = fs.readdirSync(entityDir);
  const locationFiles = fs.readdirSync(locationDir);

  let rendered = 0;
  let reused = 0;
  let failed = 0;
  const tally = (stat: AssetRenderStat) => {
    if (stat.rendered) rendered++;
    else if (stat.failed) failed++;
    else reused++;
  };

  const entityTarget = { subfolder: ENTITY_SUBFOLDER, mode: 'character_t2i' as const };
  const locationTarget = { subfolder: LOCATION_SUBFOLDER, mode: 'general_t2i' as const };

  // 角色与道具分两趟跑：避免道具图混进人物、人物图里长出道具
  const characters = await asyncPool(
    concurrency,
    entities.characters,
    async (c) => {
      const { url, stat } = await renderOne(
        projectId,
        c.characterId,
        buildCharacterLookDevPrompt(c, entities.artStyle),
        CHARACTER_LOOKDEV_NEGATIVE,
        CHARACTER_LOOKDEV_SIZE,
        entityFiles,
        force,
        entityTarget
      );
      tally(stat);
      return { ...c, referenceImageUrl: url };
    },
    'LookDev'
  );

  const items = await asyncPool(
    concurrency,
    entities.items,
    async (it) => {
      const { url, stat } = await renderOne(
        projectId,
        it.itemId,
        buildItemLookDevPrompt(it, entities.artStyle),
        ITEM_LOOKDEV_NEGATIVE,
        ITEM_LOOKDEV_SIZE,
        entityFiles,
        force,
        entityTarget
      );
      tally(stat);
      return { ...it, referenceImageUrl: url };
    },
    'LookDev'
  );

  // 场景空镜单独一趟：它是唯一会进画面的资产，画幅跟随全剧配置
  const locations = await asyncPool(
    concurrency,
    entities.locations || [],
    async (loc) => {
      const { url, stat } = await renderOne(
        projectId,
        loc.locationId,
        buildLocationLookDevPrompt(loc, entities.artStyle),
        LOCATION_LOOKDEV_NEGATIVE,
        config.frame.imageSize,
        locationFiles,
        force,
        locationTarget
      );
      tally(stat);
      return { ...loc, referenceImageUrl: url };
    },
    'LookDev'
  );

  const resolved: GlobalEntities = { artStyle: entities.artStyle, characters, items, locations };

  // 母本台账：明确记下这次用的是哪一版母本，便于人工替换后追溯
  const scenesDir = path.resolve(projectDir, 'scenes');
  fs.mkdirSync(scenesDir, { recursive: true });
  fs.writeFileSync(
    path.resolve(scenesDir, 'lookdev.json'),
    JSON.stringify(resolved, null, 2),
    'utf-8'
  );

  return { entities: resolved, rendered, reused, failed };
}

/** 判断一批资产是否已经全部拿到母本图（供工序缓存与门禁复用） */
export function hasCompleteLookdev(entities?: GlobalEntities | null): boolean {
  if (!entities) return false;
  const all = [
    ...(entities.characters || []),
    ...(entities.items || []),
    ...(entities.locations || []),
  ];
  if (all.length === 0) return false;
  return all.every((e) => Boolean(e.referenceImageUrl));
}
