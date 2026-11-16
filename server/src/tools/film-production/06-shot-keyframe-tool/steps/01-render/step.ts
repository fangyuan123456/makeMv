/**
 * tools/film-production/06-shot-keyframe-tool/steps/01-render/step.ts
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
} from './prompt.js';

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
      if (customPrompt && customPrompt.trim()) {
        targetShot.firstFramePrompt = customPrompt.trim();
      }

      const isCustomRedo = Boolean(customPrompt || referenceImageUrls?.length);
      if (targetShot.firstFrameImageUrl && !force && !isCustomRedo) {
        return true;
      }

      // 动态反查并自动装配角色定妆照与场景母本图 (确保人物长相与场景质感视听一致性)
      if (entities) {
        if ((!targetShot.characterReferenceImageUrls || targetShot.characterReferenceImageUrls.length === 0) && targetShot.characters?.length) {
          const charUrls = targetShot.characters
            .map((cid: string) => entities.characters?.find((c: any) => c.characterId === cid)?.referenceImageUrl)
            .filter(Boolean) as string[];
          if (charUrls.length > 0) {
            targetShot.characterReferenceImageUrls = charUrls;
          }
        }

        if (!targetShot.backgroundImageUrl && entities.locations?.length) {
          const matchedLoc = entities.locations.find((l: any) =>
            l.sceneIds?.includes(targetClip.clipId) || l.locationId === targetClip.clipId || l.locationId.includes(targetClip.clipId)
          ) || entities.locations[0];
          if (matchedLoc?.referenceImageUrl) {
            targetShot.backgroundImageUrl = matchedLoc.referenceImageUrl;
          }
        }
      }

      const systemReferences = [
        targetShot.backgroundImageUrl,
        ...(targetShot.characterReferenceImageUrls || []),
      ].filter(Boolean) as string[];

      const combinedReferences = [
        ...(referenceImageUrls || []),
        ...systemReferences,
      ];

      const prompt = customPrompt && customPrompt.trim()
        ? customPrompt.trim()
        : buildShotKeyframePrompt(targetShot);
      const negativePrompt = customNegativePrompt || KEYFRAME_NEGATIVE_PROMPT;

      try {
        const res: any = await (imageGenerateTool.execute as any)({
          context: {
            projectId,
            prompt,
            negativePrompt,
            referenceImageUrls: combinedReferences.length ? combinedReferences : undefined,
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
      } catch (err: any) {
        if (isAbortError(err)) throw err;
        throw new Error(`[ShotKeyframeTool] 镜头 [${targetShot.shotId}] 首帧渲染失败: ${err?.message || err}`);
      }

      // 首尾帧模式下生成尾帧
      if (targetShot.generationMode === 'first_last_frame' && targetShot.lastFramePrompt) {
        try {
          const lastRes: any = await (imageGenerateTool.execute as any)({
            context: {
              projectId,
              prompt: targetShot.lastFramePrompt,
              negativePrompt: KEYFRAME_NEGATIVE_PROMPT,
              referenceImageUrls: combinedReferences.length ? combinedReferences : undefined,
              size: KEYFRAME_IMAGE_SIZE,
              subfolder: 'keyframes',
              customFilename: `${targetShot.shotId}-last`,
            },
          });
          const lastMediaUrl = lastRes?.mediaUrl || lastRes?.imageUrl;
          if (lastRes?.success && lastMediaUrl) {
            targetShot.lastFrameImageUrl = lastMediaUrl;
          }
        } catch (err: any) {
          if (isAbortError(err)) throw err;
          console.warn(`[ShotKeyframeTool] 镜头 [${targetShot.shotId}] 尾帧渲染非阻断性告警:`, err);
        }
      }

      return Boolean(targetShot.firstFrameImageUrl);
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
      success: Boolean(matchedShot.firstFrameImageUrl),
    };
  },
});
