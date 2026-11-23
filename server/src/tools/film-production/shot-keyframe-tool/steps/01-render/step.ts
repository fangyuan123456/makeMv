/**
 * tools/film-production/shot-keyframe-tool/steps/01-render/step.ts
 * 分镜关键帧出图执行器与原子 Step (支持单镜头与全剧批量两栖执行)
 */

import path from 'node:path';
import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { atomicWriteJsonSync } from '../../../../../utils/atomicFile.js';
import {
  appendFrameVersion,
  buildShotMediaFileName,
  newFrameVersionId,
  readFrameVersions,
} from '../../../../../project-store/shot-frame-versions.js';
import { imageGenerateTool } from '../../../../media/image-generate.tool.js';
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
  type KeyframeReferenceEntry,
} from './prompt.js';
import { CINEMATIC_KEYFRAME_NEGATIVE_PROMPT } from '../../../shared/cinematography-grammar.js';

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
  customReferenceUrls?: string[],
  customRole: 'custom' | 'base_frame' = 'custom',
  previousShot?: any,
  currentIdx?: number
): KeyframeReferenceEntry[] {
  const entries: KeyframeReferenceEntry[] = [];
  const seen = new Set<string>();

  // 1. 创作者手动指定的垫图参考
  for (const url of customReferenceUrls || []) {
    appendUniqueReference(entries, seen, { role: customRole, url });
  }

  // 2. 前序镜头连续性末帧参考（影视级时空视听连续性 SSOT）
  const continuityMode = targetShot.continuityMode || 'auto';
  const isSameScene =
    !targetShot.location ||
    !previousShot?.location ||
    targetShot.location === previousShot.location;
  const shouldInheritPreceding =
    continuityMode === 'linked' ||
    (continuityMode === 'auto' && previousShot && isSameScene);

  if (shouldInheritPreceding && previousShot) {
    const prevTailUrl = cleanUrl(
      previousShot.lastFrameImageUrl ||
      previousShot.firstFrameImageUrl ||
      previousShot.keyframeUrl ||
      previousShot.imageUrl
    );
    if (prevTailUrl) {
      appendUniqueReference(entries, seen, {
        role: 'preceding_frame',
        url: prevTailUrl,
        name: previousShot.title || `前序镜头 ${String((currentIdx || 1)).padStart(2, '0')}`,
      });
    }
  }

  // 3. 出场角色三视图（优先作为主角视觉锚点基准 <image1>，支持显式 @角色 智能注入与扫描）
  const activeCharKeys = new Set<string>([
    ...(Array.isArray(targetShot.characters) ? targetShot.characters : []),
    ...(Array.isArray(targetShot.characterIds) ? targetShot.characterIds : []),
  ]);
  const shotText = `${targetShot.title || ''} ${targetShot.sceneSubject || ''} ${targetShot.firstFramePrompt || ''} ${targetShot.poseDirective?.label || ''} ${targetShot.poseDirective?.instruction || ''}`;
  if (Array.isArray(entities?.characters) && entities.characters.length > 0) {
    for (const ch of entities.characters) {
      if (ch.name && (shotText.includes(`@${ch.name}`) || shotText.includes(ch.name))) {
        activeCharKeys.add(ch.characterId || ch.name);
      }
    }
  }

  if (entities?.characters?.length && activeCharKeys.size > 0) {
    const freshCharUrls: string[] = [];
    for (const cid of activeCharKeys) {
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

  // 4. 场景母本图（优先匹配 @场景名称，作为材质肌理与光影色调参考）
  let matchedLoc: any;
  if (entities?.locations?.length) {
    // 优先检测提示词中显式 @ 的场景
    matchedLoc = entities.locations.find(
      (l: any) => l.name && (shotText.includes(`@${l.name}`) || shotText.includes(l.name))
    );
    if (!matchedLoc) {
      matchedLoc =
        entities.locations.find(
          (l: any) =>
            l.sceneIds?.includes(targetClip.clipId) ||
            l.locationId === targetClip.clipId ||
            l.locationId.includes(targetClip.clipId)
        ) || entities.locations[0];
    }
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

  // 5. 关键剧情道具特写图（支持 targetShot.items、targetShot.itemIds 以及显式 @道具 智能扫描）
  const declaredItemIds = new Set<string>([
    ...(Array.isArray(targetShot.items) ? targetShot.items : []),
    ...(Array.isArray(targetShot.itemIds) ? targetShot.itemIds : []),
  ]);
  if (Array.isArray(entities?.items) && entities.items.length > 0) {
    for (const it of entities.items) {
      if (it.name && (shotText.includes(`@${it.name}`) || shotText.includes(it.name))) {
        declaredItemIds.add(it.itemId || it.name);
      }
    }
    for (const iid of declaredItemIds) {
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
      instruction,
      maskImageUrl,
      denoise: explicitDenoise,
      continuityMode,
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
      const refineInstruction = instruction?.trim() || undefined;
      const effectiveFirstPrompt = customPrompt?.trim() || targetShot.firstFramePrompt;
      const effectiveLastPrompt =
        (frame === 'last' ? customPrompt?.trim() : undefined) || targetShot.lastFramePrompt;

      const shotList = Array.isArray(targetClip.shots) ? targetClip.shots : [];
      const currentIdx = shotList.findIndex(
        (s: any) => (s.shotId || s.id) === (targetShot.shotId || targetShot.id)
      );
      const previousShot = currentIdx > 0 ? shotList[currentIdx - 1] : undefined;

      const baseReferences = resolveShotReferenceEntries(
        targetClip,
        targetShot,
        entities,
        referenceImageUrls,
        refineInstruction ? 'base_frame' : 'custom',
        previousShot,
        currentIdx
      );
      const negativePrompt = customNegativePrompt || CINEMATIC_KEYFRAME_NEGATIVE_PROMPT;

      // 1. 生成首帧
      if (renderFirst && (!targetShot.firstFrameImageUrl || force || isCustomRedo)) {
        const isRefining = Boolean(refineInstruction && targetShot.firstFrameImageUrl);
        const existingVersions = readFrameVersions(targetShot, 'first');
        let currentSeq = existingVersions.length + 1;
        const firstCameraDir = targetShot.firstFrameCameraDirective || targetShot.cameraDirective;
        const firstColorDir = targetShot.firstFrameColorDirective || targetShot.colorDirective;
        const firstPoseDir = targetShot.firstFramePoseDirective || targetShot.poseDirective;
        const visualTag = firstCameraDir?.presetId || firstCameraDir?.label || 'close';

        // 单次单版本执行（尊重镜头独立机位与指定连续性，彻底根除自动双轨造成多镜版本混淆）
        const effectiveCont = continuityMode || targetShot.continuityMode || 'detached';
        const finalRefs =
          effectiveCont === 'linked'
            ? baseReferences
            : baseReferences.filter((r) => r.role !== 'preceding_frame');

        if (isRefining && !referenceImageUrls?.length) {
          finalRefs.unshift({
            role: 'base_frame',
            url: targetShot.firstFrameImageUrl,
          });
        }
        const refUrls = finalRefs.map((r) => r.url);
        const prompt = buildShotKeyframePrompt(targetShot, finalRefs, effectiveFirstPrompt, refineInstruction);
        const effectiveDenoise = explicitDenoise ?? (isRefining ? 0.50 : 1.0);
        const { fileName } = buildShotMediaFileName({
          shotId: targetShot.shotId,
          kind: 'first',
          continuityMode: effectiveCont,
          visualOrMotionTag: visualTag,
          versionSeq: currentSeq,
        });

        try {
          const res: any = await (imageGenerateTool.execute as any)({
            context: {
              projectId,
              prompt,
              negativePrompt,
              mode: refUrls.length > 0 ? 'character_ref2i' : 'character_t2i',
              referenceImageUrls: refUrls.length > 0 ? refUrls : undefined,
              denoise: effectiveDenoise,
              maskImageUrl,
              size: KEYFRAME_IMAGE_SIZE,
              subfolder: 'keyframes',
              customFilename: fileName.replace(/\.[^.]+$/, ''),
            },
          });

          const mediaUrl = res?.mediaUrl || res?.imageUrl;
          if (!res?.success || !mediaUrl) {
            throw new Error(res?.error || '首帧关键帧渲染未产出有效图片地址');
          }
          if (customPrompt?.trim()) {
            targetShot.firstFramePrompt = customPrompt.trim();
          }
          appendFrameVersion(targetShot, 'first', {
            imageUrl: mediaUrl,
            fileName,
            prompt: effectiveFirstPrompt,
            instruction: refineInstruction,
            continuityMode: effectiveCont,
            cameraDirective: firstCameraDir,
            colorDirective: firstColorDir,
            poseDirective: firstPoseDir,
            source: refineInstruction ? 'refine' : (effectiveCont === 'detached' ? 'detached_composition' : 'generate'),
          });
        } catch (err: any) {
          if (isAbortError(err)) throw err;
          throw new Error(`[ShotKeyframeTool] 镜头 [${targetShot.shotId}] 首帧渲染失败: ${err?.message || err}`);
        }
      }

      // 2. 生成尾帧（首尾帧模式或单点指定 frame: 'last'）
      if (renderLast && (targetShot.lastFramePrompt || customPrompt?.trim())) {
        const isLastRefining = Boolean(frame === 'last' && refineInstruction && targetShot.lastFrameImageUrl);
        const lastReferences: KeyframeReferenceEntry[] = [...baseReferences];
        const seenLast = new Set(lastReferences.map((r) => r.url));
        const lastExistingVersions = readFrameVersions(targetShot, 'last');
        const lastSeq = lastExistingVersions.length + 1;
        const lastCameraDir = targetShot.lastFrameCameraDirective || targetShot.cameraDirective;
        const lastColorDir = targetShot.lastFrameColorDirective || targetShot.colorDirective;
        const lastPoseDir = targetShot.lastFramePoseDirective || targetShot.poseDirective;
        const lastVisualTag = lastCameraDir?.presetId || lastCameraDir?.label || 'close';

        if (isLastRefining && !referenceImageUrls?.length) {
          lastReferences.unshift({
            role: 'base_frame',
            url: targetShot.lastFrameImageUrl,
          });
        } else if (targetShot.firstFrameImageUrl) {
          appendUniqueReference(lastReferences, seenLast, {
            role: 'first_frame',
            url: targetShot.firstFrameImageUrl,
          });
        }

        const lastRefUrls = lastReferences.map((r) => r.url);
        const lastPrompt = buildShotKeyframePrompt(
          targetShot,
          lastReferences,
          effectiveLastPrompt,
          frame === 'last' ? refineInstruction : undefined
        );
        const effectiveLastDenoise = explicitDenoise ?? (isLastRefining ? 0.50 : 1.0);
        const { fileName: lastFileName } = buildShotMediaFileName({
          shotId: targetShot.shotId,
          kind: 'last',
          continuityMode: 'detached',
          visualOrMotionTag: lastVisualTag,
          versionSeq: lastSeq,
        });

        try {
          const lastRes: any = await (imageGenerateTool.execute as any)({
            context: {
              projectId,
              prompt: lastPrompt,
              negativePrompt,
              mode: lastRefUrls.length > 0 ? 'character_ref2i' : 'character_t2i',
              referenceImageUrls: lastRefUrls.length > 0 ? lastRefUrls : undefined,
              denoise: effectiveLastDenoise,
              maskImageUrl,
              size: KEYFRAME_IMAGE_SIZE,
              subfolder: 'keyframes',
              customFilename: lastFileName.replace(/\.[^.]+$/, ''),
            },
          });
          const lastMediaUrl = lastRes?.mediaUrl || lastRes?.imageUrl;
          if (!lastRes?.success || !lastMediaUrl) {
            if (frame === 'last') {
              throw new Error(lastRes?.error || '末帧关键帧渲染未产出有效图片地址');
            }
          } else {
            if (frame === 'last' && customPrompt?.trim()) {
              targetShot.lastFramePrompt = customPrompt.trim();
            }
            appendFrameVersion(targetShot, 'last', {
              imageUrl: lastMediaUrl,
              fileName: lastFileName,
              prompt: effectiveLastPrompt,
              instruction: frame === 'last' ? refineInstruction : undefined,
              continuityMode: 'detached',
              cameraDirective: lastCameraDir,
              colorDirective: lastColorDir,
              poseDirective: lastPoseDir,
              source: frame === 'last' && refineInstruction ? 'refine' : 'generate',
            });
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
