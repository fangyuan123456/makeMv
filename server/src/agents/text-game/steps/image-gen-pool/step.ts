/**
 * agents/text-game/steps/image-gen-pool/step.ts
 * 并发视觉资产池生图工序 (imageGenPoolStep) - 基于 Mastra 官方微内核原生 Step
 *
 * 核心流程（先定妆 → 再尾帧多定妆融合生图，防脱节、防拼装）：
 * 1. 阶段 A（并发定妆）：复用 Qwen-Image 2.1 character_t2i 为全剧所有角色与道具生成独立定妆母本图；
 * 2. 阶段 B（并发尾帧统一生图）：按每幕 entityIds 汇总所需角色与道具定妆照，连同尾帧提示词注入 scene_ref2i 生成单张完整尾帧图；
 * 3. 物理独立持久化：将所有 SingleSceneJson 写入 data/projects/:projectId/scenes/:sceneId.json。
 */

import { createStep } from '@mastra/core/workflows';
import path from 'path';
import fs from 'fs';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { MediaResolver } from '../../../../media/MediaResolver.js';
import { imageGenerateTool } from '../../../../tools/image-generate/image-generate.tool.js';
import { isAbortError, throwIfRunAborted } from '../../../../workflow-engine/run-context.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import type { GlobalEntities, SingleSceneJson } from '../../schema.js';
import {
  ImageGenPoolInputSchema,
  ImageGenPoolOutputSchema,
  type ImageGenPoolInput,
  type ImageGenPoolOutput,
} from './schema.js';

/**
 * 轻量通用异步并发控制器
 */
async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing: Set<Promise<any>> = new Set();

  for (let i = 0; i < array.length; i++) {
    throwIfRunAborted('ImageGenPool');
    const item = array[i];
    const p = Promise.resolve().then(() => {
      throwIfRunAborted('ImageGenPool');
      return iteratorFn(item, i);
    });
    ret.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean, clean);

    if (executing.size >= poolLimit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(ret);
}

/** 角色/道具母本图统一落盘目录：全项目一份，各幕只放引用不复制二进制 */
const ENTITY_SUBFOLDER = 'assets/entities';
const SCENE_SUBFOLDER = 'assets/scenes';
const MAX_SCENE_REF_IMAGES = 6;

const CHARACTER_LOOKDEV_NEGATIVE =
  '低分辨率，低画质，肢体畸形，手指畸形，多手多脚，画面过饱和，文字，水印，标签，边框，拼贴，分格线，多个人物，场景背景，街景，室外场景，半身裁切';

const ITEM_LOOKDEV_NEGATIVE =
  '低分辨率，低画质，文字，水印，标签，边框，拼贴，分格线，人物，手部，手指，多件物品，杂乱背景，室内街景';

const SCENE_END_NEGATIVE =
  '低分辨率，低画质，肢体畸形，手指畸形，多手多脚，拼贴，分格线，多格漫画，边框，画中画，角色设定卡，三视图，纯灰无缝背景，文字，水印，标签';

interface ResolvedEntityMeta {
  id: string;
  kind: 'character' | 'item';
  name: string;
  summary: string;
  url: string;
}

function buildCharacterLookDevPrompt(
  character: GlobalEntities['characters'][number],
  artStyle: string
): string {
  const base = character.promptZh || character.promptEn || character.appearanceSummary;
  return `角色定妆照，单人正面全身站姿，双脚着地，五官清晰：${base}。外貌细节锁定：${character.appearanceSummary}。纯中性浅灰无缝工作室背景，画面中只有这一个人，无文字无标签无水印。${artStyle}`;
}

function buildItemLookDevPrompt(
  item: GlobalEntities['items'][number],
  artStyle: string
): string {
  const base = item.promptZh || item.promptEn || item.appearanceSummary;
  return `关键道具定妆特写，单个完整道具居中构图，清晰展示器型、材质与纹饰细节：${base}。道具特征锁定：${item.appearanceSummary}。纯中性浅灰无缝工作室背景，无手部无人物入镜，无多余场景杂物，无文字无标签无水印。${artStyle}`;
}

function assembleEndFrameScenePrompt(
  scene: SingleSceneJson,
  orderedRefs: ResolvedEntityMeta[],
  artStyle: string
): string {
  const va = scene.visualAnchor;
  const baseSceneDesc = va.promptZh || va.promptEn;

  if (orderedRefs.length === 0) {
    return [
      '单幅完整电影级尾帧空镜画面（严禁拼贴、严禁分格、严禁文字水印）：',
      `【尾帧定格画面】：${va.endFrameMoment}`,
      `【画面构图与内容】：${baseSceneDesc}`,
      `【镜头机位】：${va.cameraAngle}`,
      `【光影与美术风格】：${va.lighting}，${artStyle}`,
    ].join('\n');
  }

  const refBindings = orderedRefs.map((ent, idx) =>
    ent.kind === 'character'
      ? `- <image${idx + 1}> 为角色【${ent.name}】定妆基准（保持脸型五官、发型发色、服装款式与配饰完全一致：${ent.summary}）`
      : `- <image${idx + 1}> 为道具【${ent.name}】定妆基准（保持器型比例、材质色泽与关键特征完全一致：${ent.summary}）`
  );

  return [
    '请严格参照以下各张定妆参考图，将所有指定角色与道具自然融合生成在同一张连贯完整的电影级尾帧场景画面中（单幅一体化构图，严禁多图拼装、严禁分格线、严禁画中画、严禁设定卡样式）：',
    ...refBindings,
    '',
    `【尾帧定格画面】：${va.endFrameMoment}`,
    `【画面主体与场景细节】：${baseSceneDesc}`,
    `【镜头机位与景别】：${va.cameraAngle}`,
    `【光影与统一画风】：${va.lighting}，${artStyle}`,
  ].join('\n');
}

/**
 * 为一个实体生成（或复用）定妆母本图，并把 /media/... URL 回填进去。
 * 失败不阻断整批：该实体只是不参与本轮参考图注入。
 */
async function withEntityRef<T extends object>(
  entry: T,
  id: string,
  prompt: string,
  negativePrompt: string,
  size: string,
  projectId: string,
  existing: string[],
  force: boolean
): Promise<T & { referenceImageUrl?: string }> {
  const found = existing.find((f) => f.startsWith(`${id}.`));
  const cachedUrl = found
    ? MediaResolver.toMediaUrl(projectId, ENTITY_SUBFOLDER, found)
    : undefined;
  if (cachedUrl && !force) return { ...entry, referenceImageUrl: cachedUrl };

  try {
    const res = await (imageGenerateTool.execute as any)({
      context: {
        projectId,
        prompt,
        negativePrompt,
        mode: 'character_t2i',
        size,
        subfolder: ENTITY_SUBFOLDER,
        customFilename: id,
      },
    });
    if (res?.success && res?.mediaUrl) {
      return { ...entry, referenceImageUrl: res.mediaUrl };
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
    console.warn(`[ImageGenPool] 实体定妆 [${id}] 生成失败，跳过参考图:`, err);
  }

  return cachedUrl ? { ...entry, referenceImageUrl: cachedUrl } : { ...entry };
}

/**
 * 阶段 A：全项目先通过提示词为全部角色与道具生成统一 Qwen-Image 2.1 定妆母本。
 * 这些图是「可人工替换的一等资产」：替换磁盘文件后，按 forceSceneIds 重跑受影响幕即可。
 */
async function prepareEntityReferences(
  projectId: string,
  entities: GlobalEntities,
  force: boolean,
  concurrency: number
): Promise<GlobalEntities> {
  const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
  const dir = path.resolve(projectDir, ENTITY_SUBFOLDER);
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.readdirSync(dir);

  const characters = await asyncPool(concurrency, entities.characters, (c) =>
    withEntityRef(
      c,
      c.characterId,
      buildCharacterLookDevPrompt(c, entities.artStyle),
      CHARACTER_LOOKDEV_NEGATIVE,
      '768*1344',
      projectId,
      existing,
      force
    )
  );

  const items = await asyncPool(concurrency, entities.items, (it) =>
    withEntityRef(
      it,
      it.itemId,
      buildItemLookDevPrompt(it, entities.artStyle),
      ITEM_LOOKDEV_NEGATIVE,
      '1024*1024',
      projectId,
      existing,
      force
    )
  );

  return {
    artStyle: entities.artStyle,
    characters,
    items,
  };
}

export async function executeImageGenPoolStep(
  input: ImageGenPoolInput
): Promise<ImageGenPoolOutput> {
  const { projectId, scenes, entities, concurrency = 4, force = false, forceSceneIds = [] } = input;
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);

  // 确保场景与资源持久化目录存在
  const scenesDir = path.resolve(projectDir, 'scenes');
  const assetsDir = path.resolve(projectDir, SCENE_SUBFOLDER);
  fs.mkdirSync(scenesDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  // 1. 先备好全项目唯一的角色/道具定妆母本图，再落 entities.json（含可人工替换的 /media URL）
  const resolvedEntities = await prepareEntityReferences(projectId, entities, force, concurrency);
  const entitiesPath = path.resolve(scenesDir, 'entities.json');
  fs.writeFileSync(entitiesPath, JSON.stringify(resolvedEntities, null, 2), 'utf-8');

  const entityMetaMap = new Map<string, ResolvedEntityMeta>();
  for (const c of resolvedEntities.characters) {
    if (c.referenceImageUrl) {
      entityMetaMap.set(c.characterId, {
        id: c.characterId,
        kind: 'character',
        name: c.name,
        summary: c.appearanceSummary,
        url: c.referenceImageUrl,
      });
    }
  }
  for (const it of resolvedEntities.items) {
    if (it.referenceImageUrl) {
      entityMetaMap.set(it.itemId, {
        id: it.itemId,
        kind: 'item',
        name: it.name,
        summary: it.appearanceSummary,
        url: it.referenceImageUrl,
      });
    }
  }

  let renderedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // 2. 并发池生成每幕尾帧统一场景图（尾帧提示词 + 该幕所需角色与道具定妆参考图）
  const updatedScenes = await asyncPool<SingleSceneJson, SingleSceneJson>(
    concurrency,
    scenes,
    async (scene) => {
      // 本幕素材自包含：按优先级（出场角色在前、关键道具在后）汇总本幕全部实体定妆参考图
      const resolvedAll: ResolvedEntityMeta[] = [];
      for (const id of scene.entityIds || []) {
        const meta = entityMetaMap.get(id);
        if (meta) resolvedAll.push(meta);
      }
      scene.entityRefs = Object.fromEntries(resolvedAll.map((m) => [m.id, m.url]));

      const orderedRefs = [
        ...resolvedAll.filter((m) => m.kind === 'character'),
        ...resolvedAll.filter((m) => m.kind === 'item'),
      ].slice(0, MAX_SCENE_REF_IMAGES);

      const referenceImageUrls = orderedRefs.map((m) => m.url);
      const assembledPrompt = assembleEndFrameScenePrompt(
        scene,
        orderedRefs,
        resolvedEntities.artStyle
      );
      scene.visualAnchor.assembledPrompt = assembledPrompt;

      // 检查是否已有落盘尾帧图片
      const existingFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
      const found = existingFiles.find((f) => f.startsWith(`${scene.sceneId}_end.`));
      const mustRegen = force || forceSceneIds.includes(scene.sceneId);

      if (found && !mustRegen) {
        skippedCount++;
        scene.visualAnchor.sceneImagePath = `${SCENE_SUBFOLDER}/${found}`;
        scene.visualAnchor.sceneImageUrl = MediaResolver.toMediaUrl(projectId, SCENE_SUBFOLDER, found);
        const sceneJsonPath = path.resolve(scenesDir, `${scene.sceneId}.json`);
        fs.writeFileSync(sceneJsonPath, JSON.stringify(scene, null, 2), 'utf-8');
        return scene;
      }

      try {
        const renderRes = await (imageGenerateTool.execute as any)({
          context: {
            projectId,
            prompt: assembledPrompt,
            negativePrompt: SCENE_END_NEGATIVE,
            mode: referenceImageUrls.length > 0 ? 'scene_ref2i' : 'character_t2i',
            ...(referenceImageUrls.length > 0 ? { referenceImageUrls } : {}),
            size: '768*1344', // 9:16 竖屏短剧（32 的整数倍）
            subfolder: SCENE_SUBFOLDER,
            customFilename: `${scene.sceneId}_end`,
          },
        });

        if (renderRes?.success && renderRes?.diskPath) {
          renderedCount++;
          const relPath = path.relative(projectDir, renderRes.diskPath).replace(/\\/g, '/');
          scene.visualAnchor.sceneImagePath = relPath;
          scene.visualAnchor.sceneImageUrl =
            renderRes.mediaUrl ||
            MediaResolver.toMediaUrl(projectId, SCENE_SUBFOLDER, path.basename(renderRes.diskPath));
          const stalePlaceholder = path.resolve(assetsDir, `${scene.sceneId}_placeholder.svg`);
          if (fs.existsSync(stalePlaceholder)) {
            try {
              fs.unlinkSync(stalePlaceholder);
            } catch {}
          }
        } else {
          // 占位图用 _placeholder 命名，绝不占用 _end. 成果名，否则失败永远无法重试
          console.warn(`[ImageGenPool] 场景 [${scene.sceneId}] 尾帧生图未返回落盘文件，计入失败`);
          const fallbackFilename = `${scene.sceneId}_placeholder.svg`;
          const localDiskPath = path.resolve(assetsDir, fallbackFilename);
          if (!fs.existsSync(localDiskPath)) {
            const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1344" viewBox="0 0 768 1344">
  <rect width="100%" height="100%" fill="#111827"/>
  <text x="50%" y="45%" text-anchor="middle" fill="#9ca3af" font-size="28" font-family="sans-serif">${scene.sceneId}: ${scene.title}</text>
  <text x="50%" y="52%" text-anchor="middle" fill="#6b7280" font-size="16" font-family="sans-serif">${scene.visualAnchor.cameraAngle}</text>
</svg>`;
            fs.writeFileSync(localDiskPath, svgContent, 'utf-8');
          }
          failedCount++;
          scene.visualAnchor.sceneImagePath = `${SCENE_SUBFOLDER}/${fallbackFilename}`;
          scene.visualAnchor.sceneImageUrl = MediaResolver.toMediaUrl(projectId, SCENE_SUBFOLDER, fallbackFilename);
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
        console.warn(`[ImageGenPool] 场景 [${scene.sceneId}] 尾帧图渲染失败，注入占位图:`, err);
        const fallbackFilename = `${scene.sceneId}_placeholder.svg`;
        const localDiskPath = path.resolve(assetsDir, fallbackFilename);
        if (!fs.existsSync(localDiskPath)) {
          const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1344" viewBox="0 0 768 1344">
  <rect width="100%" height="100%" fill="#111827"/>
  <text x="50%" y="45%" text-anchor="middle" fill="#9ca3af" font-size="28" font-family="sans-serif">${scene.sceneId}: ${scene.title}</text>
  <text x="50%" y="52%" text-anchor="middle" fill="#6b7280" font-size="16" font-family="sans-serif">${scene.visualAnchor.cameraAngle}</text>
</svg>`;
          fs.writeFileSync(localDiskPath, svgContent, 'utf-8');
        }
        failedCount++;
        scene.visualAnchor.sceneImagePath = `${SCENE_SUBFOLDER}/${fallbackFilename}`;
        scene.visualAnchor.sceneImageUrl = MediaResolver.toMediaUrl(projectId, SCENE_SUBFOLDER, fallbackFilename);
      }

      // 3. 每一个场景 JSON 独立写盘
      const sceneJsonPath = path.resolve(scenesDir, `${scene.sceneId}.json`);
      fs.writeFileSync(sceneJsonPath, JSON.stringify(scene, null, 2), 'utf-8');

      return scene;
    }
  );

  throwIfRunAborted('ImageGenPool');

  // 4. 同步更新状态黑板 Artifact
  store.setArtifact(projectId, 'scene_package', {
    scenes: updatedScenes,
    entities: resolvedEntities,
    updatedAt: new Date().toISOString(),
  });

  return {
    projectId,
    totalScenes: updatedScenes.length,
    renderedCount,
    skippedCount,
    failedCount,
    entities: resolvedEntities,
    scenes: updatedScenes,
  };
}

export const imageGenPoolStep = createStep({
  id: 'image-gen-pool-step',
  inputSchema: ImageGenPoolInputSchema,
  outputSchema: ImageGenPoolOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const trigger = ctx.triggerData || ctx;
    const projectId = trigger.projectId || ctx.projectId;
    const packaging = ctx.steps?.['scene-packaging-step']?.output;
    const scenes = packaging?.scenes || ctx.scenes || [];
    const entities = ctx.steps?.['entity-extract-step']?.output || ctx.entities || { characters: [], items: [] };
    const force = !!(trigger.force ?? ctx.force);
    const forceSceneIds = trigger.forceSceneIds ?? ctx.forceSceneIds ?? [];

    return await runTaskRecordedStep(
      'image-gen-pool-step',
      () =>
        executeImageGenPoolStep({
          projectId,
          scenes,
          entities,
          concurrency: trigger.concurrency ?? ctx.concurrency ?? 4,
          force,
          forceSceneIds,
        }),
      {
        skipCache: force || forceSceneIds.length > 0,
        verifyCached: (cached) => {
          const store = ProjectStore.getInstance();
          const projectDir = store.getProjectDir(projectId);
          return (
            Array.isArray(cached.scenes) &&
            cached.scenes.length > 0 &&
            cached.scenes.every((s) =>
              fs.existsSync(path.resolve(projectDir, 'scenes', `${s.sceneId}.json`))
            )
          );
        },
        onCacheHit: (cached) => {
          ProjectStore.getInstance().setArtifact(projectId, 'scene_package', {
            scenes: cached.scenes,
            entities: cached.entities,
            updatedAt: new Date().toISOString(),
          });
        },
      }
    );
  },
});
