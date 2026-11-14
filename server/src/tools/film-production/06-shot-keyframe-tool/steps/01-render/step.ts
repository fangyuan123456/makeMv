/**
 * tools/film-production/06-shot-keyframe-tool/steps/01-render/step.ts
 * 分镜关键帧出图执行器与原子 Step
 */

import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
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
  description: '为分镜镜头生成高清首尾帧关键帧图片并与镜头强绑定',
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

    const clip = filmSpec.clips?.find((c: any) => c.clipId === clipId);
    const shot = clip?.shots?.find((s: any) => s.shotId === shotId);
    if (!clip || !shot) {
      throw new Error(`[ShotKeyframeTool] 未找到分镜镜头 [${clipId} · ${shotId}]`);
    }

    if (customPrompt && customPrompt.trim()) {
      shot.firstFramePrompt = customPrompt.trim();
    }

    // 1. 若已有首帧关键帧且无自定义调整并不强制重绘，直接复用
    const isCustomRedo = Boolean(customPrompt || referenceImageUrls?.length);
    if (shot.firstFrameImageUrl && !force && !isCustomRedo) {
      return {
        projectId,
        clipId,
        shotId,
        firstFrameImageUrl: shot.firstFrameImageUrl,
        lastFrameImageUrl: shot.lastFrameImageUrl,
        reused: true,
        success: true,
      };
    }

    // 2. 动态反查并自动装配角色定妆照与场景母本图 (确保人物长相与场景质感视听一致性)
    const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');
    if (entities) {
      if ((!shot.characterReferenceImageUrls || shot.characterReferenceImageUrls.length === 0) && shot.characters?.length) {
        const charUrls = shot.characters
          .map((cid: string) => entities.characters?.find((c: any) => c.characterId === cid)?.referenceImageUrl)
          .filter(Boolean) as string[];
        if (charUrls.length > 0) {
          shot.characterReferenceImageUrls = charUrls;
        }
      }

      if (!shot.backgroundImageUrl && entities.locations?.length) {
        const matchedLoc = entities.locations.find((l: any) =>
          l.sceneIds?.includes(clipId) || l.locationId === clipId || l.locationId.includes(clipId)
        ) || entities.locations[0];
        if (matchedLoc?.referenceImageUrl) {
          shot.backgroundImageUrl = matchedLoc.referenceImageUrl;
        }
      }
    }

    const systemReferences = [
      shot.backgroundImageUrl,
      ...(shot.characterReferenceImageUrls || []),
    ].filter(Boolean) as string[];

    const combinedReferences = [
      ...(referenceImageUrls || []),
      ...systemReferences,
    ];

    const prompt = customPrompt && customPrompt.trim()
      ? customPrompt.trim()
      : buildShotKeyframePrompt(shot);
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
          customFilename: `${shot.shotId}-first`,
        },
      });

      const mediaUrl = res?.mediaUrl || res?.imageUrl;
      if (!res?.success || !mediaUrl) {
        throw new Error(res?.error || '首帧关键帧渲染未产出有效图片地址');
      }
      shot.firstFrameImageUrl = mediaUrl;
    } catch (err: any) {
      if (isAbortError(err)) throw err;
      throw new Error(`[ShotKeyframeTool] 镜头 [${shotId}] 首帧渲染失败: ${err?.message || err}`);
    }

    // 3. 首尾帧模式下生成尾帧
    if (shot.generationMode === 'first_last_frame' && shot.lastFramePrompt) {
      try {
        const lastRes: any = await (imageGenerateTool.execute as any)({
          context: {
            projectId,
            prompt: shot.lastFramePrompt,
            negativePrompt: KEYFRAME_NEGATIVE_PROMPT,
            referenceImageUrls: combinedReferences.length ? combinedReferences : undefined,
            size: KEYFRAME_IMAGE_SIZE,
            subfolder: 'keyframes',
            customFilename: `${shot.shotId}-last`,
          },
        });
        const lastMediaUrl = lastRes?.mediaUrl || lastRes?.imageUrl;
        if (!lastRes?.success || !lastMediaUrl) {
          throw new Error(lastRes?.error || '尾帧关键帧渲染未产出有效图片地址');
        }
        shot.lastFrameImageUrl = lastMediaUrl;
      } catch (err: any) {
        if (isAbortError(err)) throw err;
        throw new Error(`[ShotKeyframeTool] 镜头 [${shotId}] 尾帧渲染失败: ${err?.message || err}`);
      }
    }

    // 落盘回写 film_spec
    store.setArtifact(projectId, 'film_spec', filmSpec);

    return {
      projectId,
      clipId,
      shotId,
      firstFrameImageUrl: shot.firstFrameImageUrl,
      lastFrameImageUrl: shot.lastFrameImageUrl,
      reused: false,
      success: Boolean(shot.firstFrameImageUrl),
    };
  },
});
