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
import { KEYFRAME_IMAGE_SIZE } from './prompt.js';
import { CINEMATIC_KEYFRAME_NEGATIVE_PROMPT } from '../../../shared/cinematography-grammar.js';

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

    // 单镜头执行闭包 (内部委托底层 media 算力自动编译图文注意力与多图引用)
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

        // 单次单版本执行（尊重镜头独立机位与指定连续性，前序同场景默认 auto 智能连贯）
        const isSameScene =
          !targetShot.location ||
          !previousShot?.location ||
          targetShot.location === previousShot.location;
        const effectiveCont = continuityMode || targetShot.continuityMode || (previousShot && isSameScene ? 'auto' : 'detached');
        const shouldInheritPreceding =
          effectiveCont === 'linked' ||
          (effectiveCont === 'auto' && previousShot && isSameScene);

        const precedingFrameUrl = (shouldInheritPreceding && previousShot)
          ? (previousShot.videoLastFrameUrl || previousShot.lastFrameImageUrl || previousShot.firstFrameImageUrl || previousShot.keyframeUrl || previousShot.imageUrl)
          : undefined;

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
              prompt: effectiveFirstPrompt,
              negativePrompt,
              entities,
              precedingFrameUrl,
              customReferenceUrls: referenceImageUrls,
              baseFrameUrl: isRefining ? targetShot.firstFrameImageUrl : undefined,
              instruction: refineInstruction,
              poseDirective: firstPoseDir,
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
          targetShot.continuityMode = effectiveCont;
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
        const lastExistingVersions = readFrameVersions(targetShot, 'last');
        const lastSeq = lastExistingVersions.length + 1;
        const lastCameraDir = targetShot.lastFrameCameraDirective || targetShot.cameraDirective;
        const lastColorDir = targetShot.lastFrameColorDirective || targetShot.colorDirective;
        const lastPoseDir = targetShot.lastFramePoseDirective || targetShot.poseDirective;
        const lastVisualTag = lastCameraDir?.presetId || lastCameraDir?.label || 'close';

        const effectiveLastDenoise = explicitDenoise ?? (isLastRefining ? 0.50 : 1.0);
        const { fileName: lastFileName } = buildShotMediaFileName({
          shotId: targetShot.shotId,
          kind: 'last',
          continuityMode: 'detached',
          visualOrMotionTag: lastVisualTag,
          versionSeq: lastSeq,
        });

        // 尾帧以微调基准或首帧为基准
        const baseFrame = isLastRefining
          ? targetShot.lastFrameImageUrl
          : (targetShot.firstFrameImageUrl || undefined);

        try {
          const lastRes: any = await (imageGenerateTool.execute as any)({
            context: {
              projectId,
              prompt: effectiveLastPrompt,
              negativePrompt,
              entities,
              customReferenceUrls: referenceImageUrls,
              baseFrameUrl: baseFrame,
              instruction: frame === 'last' ? refineInstruction : undefined,
              poseDirective: lastPoseDir,
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
      atomicWriteJsonSync(path.join(projectDir, 'film_spec.json'), filmSpec);
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
    atomicWriteJsonSync(path.join(projectDir, 'film_spec.json'), filmSpec);
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
