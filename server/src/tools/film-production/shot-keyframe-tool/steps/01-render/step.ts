/**
 * tools/film-production/shot-keyframe-tool/steps/01-render/step.ts
 * 分镜关键帧出图执行器与原子 Step (支持单镜头与全剧批量两栖执行)
 */

import path from 'node:path';
import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { atomicWriteJsonSync } from '../../../../../utils/atomicFile.js';
import { imageGenerateTool } from '../../../../image-generate/image-generate.tool.js';
import { isAbortError } from '../../../../../workflow-engine/run-context.js';
import type { FilmAdapterArtifact } from '../../../../../project-store/contracts/film-production/film-spec.js';
import type { GlobalEntities } from '../../../../../project-store/contracts/film-production/lookdev.js';
import {
  ShotKeyframeStepInputSchema,
  ShotKeyframeStepOutputSchema,
  type ShotKeyframeStepInput,
  type ShotKeyframeStepOutput,
} from './schema.js';
import {
  buildShotKeyframePrompt,
  KEYFRAME_IMAGE_SIZE,
  KEYFRAME_NEGATIVE_PROMPT,
  type KeyframeReferenceEntry,
} from './prompt.js';

function cleanUrl(url?: string): string {
  if (!url) return '';
  return url.split('?')[0].trim();
}

function appendUniqueReference(
  list: KeyframeReferenceEntry[],
  seenUrls: Set<string>,
  entry: KeyframeReferenceEntry
): void {
  const normalized = cleanUrl(entry.url);
  if (!normalized || seenUrls.has(normalized)) return;
  seenUrls.add(normalized);
  list.push({ ...entry, url: normalized });
}

function resolveShotReferenceEntries(
  targetClip: any,
  targetShot: any,
  entities: GlobalEntities | null | undefined,
  customReferenceUrls?: string[]
): KeyframeReferenceEntry[] {
  const entries: KeyframeReferenceEntry[] = [];
  const seen = new Set<string>();

  // 1. 创作者手动指定的垫图参考
  for (const url of customReferenceUrls || []) {
    appendUniqueReference(entries, seen, { role: 'custom', url });
  }

  // 2. 场景母本图（每次从 lookdev_entities 实时同步最新激活/超分版本）
  let matchedLoc: any;
  if (entities?.locations?.length) {
    matchedLoc =
      entities.locations.find(
        (l: any) =>
          l.sceneIds?.includes(targetClip.clipId) ||
          l.locationId === targetClip.clipId ||
          l.locationId.includes(targetClip.clipId)
      ) || entities.locations[0];
    const locImg = cleanUrl(matchedLoc?.imageUrl || matchedLoc?.referenceImageUrl);
    if (locImg) {
      targetShot.backgroundImageUrl = locImg;
    }
  }
  if (targetShot.backgroundImageUrl) {
    appendUniqueReference(entries, seen, {
      role: 'location',
      url: targetShot.backgroundImageUrl,
      name: matchedLoc?.name,
    });
  }

  // 3. 出场角色三视图（每次从 lookdev_entities 实时同步最新激活/超分版本）
  if (entities?.characters?.length && Array.isArray(targetShot.characters) && targetShot.characters.length > 0) {
    const freshCharUrls: string[] = [];
    for (const cid of targetShot.characters) {
      const matchedChar = entities.characters.find(
        (c: any) => c.characterId === cid || c.name === cid
      );
      const charImg = cleanUrl(matchedChar?.imageUrl || matchedChar?.referenceImageUrl);
      if (charImg) {
        freshCharUrls.push(charImg);
        appendUniqueReference(entries, seen, {
          role: 'character',
          url: charImg,
          name: matchedChar?.name,
          identity: matchedChar?.identity,
        });
      }
    }
    if (freshCharUrls.length > 0) {
      targetShot.characterReferenceImageUrls = freshCharUrls;
    }
  } else if (Array.isArray(targetShot.characterReferenceImageUrls)) {
    for (const url of targetShot.characterReferenceImageUrls) {
      appendUniqueReference(entries, seen, { role: 'character', url });
    }
  }

  // 4. 关键剧情道具特写图（每次从 lookdev_entities 实时同步）
  if (entities?.items?.length && Array.isArray(targetShot.items) && targetShot.items.length > 0) {
    for (const iid of targetShot.items) {
      const matchedItem = entities.items.find(
        (it: any) => it.itemId === iid || it.name === iid
      );
      const itemImg = cleanUrl(matchedItem?.imageUrl || matchedItem?.referenceImageUrl);
      if (itemImg) {
        appendUniqueReference(entries, seen, {
          role: 'item',
          url: itemImg,
          name: matchedItem?.name,
        });
      }
    }
  }

  return entries;
}

export const shotKeyframeStep = createStep({
  id: 'render-shot-keyframe',
  description: '为分镜镜头生成高清首尾帧关键帧图片并与镜头强绑定 (支持单镜头重绘与全剧批量续跑)',
  inputSchema: ShotKeyframeStepInputSchema,
  outputSchema: ShotKeyframeStepOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as ShotKeyframeStepInput;
    const {
      projectId,
      clipId,
      shotId,
      frame,
      force = false,
      customPrompt,
      customNegativePrompt,
      referenceImageUrls,
    } = input;

    const store = ProjectStore.getInstance();
    const filmSpec = store.getArtifact<FilmAdapterArtifact>(projectId, 'film_spec');

    if (!filmSpec) {
      throw new Error(`[ShotKeyframeTool] 项目 [${projectId}] 缺少 film_spec 分镜切片清单`);
    }

    const projectDir = store.getProjectDir(projectId);
    const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');

    // 单镜头执行闭包
    const renderSingleShot = async (targetClip: any, targetShot: any): Promise<boolean> => {
      const isCustomRedo = Boolean(customPrompt?.trim() || referenceImageUrls?.length);
      const renderFirst = frame !== 'last';
      const renderLast =
        frame === 'last' ||
        (!frame && targetShot.generationMode === 'first_last_frame' && Boolean(targetShot.lastFramePrompt));

      if (renderFirst && customPrompt?.trim()) {
        targetShot.firstFramePrompt = customPrompt.trim();
      }
      if (frame === 'last' && customPrompt?.trim()) {
        targetShot.lastFramePrompt = customPrompt.trim();
      }

      const baseReferences = resolveShotReferenceEntries(
        targetClip,
        targetShot,
        entities,
        referenceImageUrls
      );
      const negativePrompt = customNegativePrompt || KEYFRAME_NEGATIVE_PROMPT;

      // 1. 生成首帧
      if (renderFirst && (!targetShot.firstFrameImageUrl || force || isCustomRedo)) {
        const refUrls = baseReferences.map((r) => r.url);
        const prompt = buildShotKeyframePrompt(
          targetShot,
          baseReferences,
          customPrompt?.trim() || targetShot.firstFramePrompt
        );

        try {
          const res: any = await (imageGenerateTool.execute as any)({
            context: {
              projectId,
              prompt,
              negativePrompt,
              mode: refUrls.length > 0 ? 'character_ref2i' : 'character_t2i',
              referenceImageUrls: refUrls.length > 0 ? refUrls : undefined,
              size: KEYFRAME_IMAGE_SIZE,
              subfolder: 'keyframes',
              customFilename: `${targetShot.shotId}-first`,
            },
          });

          const mediaUrl = res?.mediaUrl || res?.imageUrl;
          if (!res?.success || !mediaUrl) {
            throw new Error(res?.error || '首帧关键帧渲染未产出有效图片地址');
          }
          targetShot.firstFrameImageUrl = mediaUrl;
          targetShot.keyframeUrl = mediaUrl;
          delete targetShot.firstFrameUpscale;
        } catch (err: any) {
          if (isAbortError(err)) throw err;
          throw new Error(`[ShotKeyframeTool] 镜头 [${targetShot.shotId}] 首帧渲染失败: ${err?.message || err}`);
        }
      }

      // 2. 生成尾帧（首尾帧模式或单点指定 frame: 'last'）
      if (renderLast && (targetShot.lastFramePrompt || customPrompt?.trim())) {
        const lastReferences: KeyframeReferenceEntry[] = [...baseReferences];
        const seenLast = new Set(lastReferences.map((r) => r.url));
        if (targetShot.firstFrameImageUrl) {
          appendUniqueReference(lastReferences, seenLast, {
            role: 'first_frame',
            url: targetShot.firstFrameImageUrl,
          });
        }
        const lastRefUrls = lastReferences.map((r) => r.url);
        const lastPrompt = buildShotKeyframePrompt(
          targetShot,
          lastReferences,
          (frame === 'last' ? customPrompt?.trim() : undefined) || targetShot.lastFramePrompt
        );

        try {
          const lastRes: any = await (imageGenerateTool.execute as any)({
            context: {
              projectId,
              prompt: lastPrompt,
              negativePrompt,
              mode: lastRefUrls.length > 0 ? 'character_ref2i' : 'character_t2i',
              referenceImageUrls: lastRefUrls.length > 0 ? lastRefUrls : undefined,
              size: KEYFRAME_IMAGE_SIZE,
              subfolder: 'keyframes',
              customFilename: `${targetShot.shotId}-last`,
            },
          });
          const lastMediaUrl = lastRes?.mediaUrl || lastRes?.imageUrl;
          if (!lastRes?.success || !lastMediaUrl) {
            if (frame === 'last') {
              throw new Error(lastRes?.error || '末帧关键帧渲染未产出有效图片地址');
            }
          } else {
            targetShot.lastFrameImageUrl = lastMediaUrl;
            delete targetShot.lastFrameUpscale;
          }
        } catch (err: any) {
          if (isAbortError(err)) throw err;
          if (frame === 'last') {
            throw new Error(`[ShotKeyframeTool] 镜头 [${targetShot.shotId}] 末帧渲染失败: ${err?.message || err}`);
          }
          console.warn(`[ShotKeyframeTool] 镜头 [${targetShot.shotId}] 尾帧渲染非阻断性告警:`, err);
        }
      }

      return frame === 'last'
        ? Boolean(targetShot.lastFrameImageUrl)
        : Boolean(targetShot.firstFrameImageUrl);
    };

    // 1. 若未提供 shotId，开启全剧批量模式 (自动跳过已有项，断点增量续画)
    if (!shotId) {
      const allShotPairs: Array<{ clip: any; shot: any }> = [];
      for (const c of filmSpec.clips || []) {
        for (const s of c.shots || []) {
          allShotPairs.push({ clip: c, shot: s });
        }
      }

      let renderedCount = 0;
      for (const pair of allShotPairs) {
        if (force || (!pair.shot.firstFrameImageUrl && !pair.shot.keyframeUrl)) {
          await renderSingleShot(pair.clip, pair.shot);
          renderedCount++;
        }
      }

      // 全量落盘与同步
      store.setArtifact(projectId, 'film_spec', filmSpec);
      store.setArtifact(projectId, 'storyboards', filmSpec.clips);
      atomicWriteJsonSync(path.join(projectDir, 'storyboards.json'), filmSpec.clips);

      return {
        projectId,
        shotId: 'all',
        reused: renderedCount === 0,
        success: true,
      };
    }

    // 2. 提供了 shotId，单镜头定向重绘模式 (支持全局反查，无需外部显式提供 clipId)
    let matchedClip = clipId ? filmSpec.clips?.find((c: any) => c.clipId === clipId) : undefined;
    let matchedShot = matchedClip?.shots?.find((s: any) => s.shotId === shotId);

    if (!matchedShot) {
      for (const c of filmSpec.clips || []) {
        const found = c.shots?.find((s: any) => s.shotId === shotId);
        if (found) {
          matchedClip = c;
          matchedShot = found;
          break;
        }
      }
    }

    if (!matchedClip || !matchedShot) {
      throw new Error(`[ShotKeyframeTool] 未在全剧分镜中找到镜头 [${shotId}]`);
    }

    await renderSingleShot(matchedClip, matchedShot);

    // 单体落盘与同步
    store.setArtifact(projectId, 'film_spec', filmSpec);
    store.setArtifact(projectId, 'storyboards', filmSpec.clips);
    atomicWriteJsonSync(path.join(projectDir, 'storyboards.json'), filmSpec.clips);

    return {
      projectId,
      clipId: matchedClip.clipId,
      shotId: matchedShot.shotId,
      firstFrameImageUrl: matchedShot.firstFrameImageUrl,
      lastFrameImageUrl: matchedShot.lastFrameImageUrl,
      reused: false,
      success: frame === 'last' ? Boolean(matchedShot.lastFrameImageUrl) : Boolean(matchedShot.firstFrameImageUrl),
    };
  },
});
