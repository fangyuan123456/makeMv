/**
 * agents/film-production/03-video-studio/cinema-act/steps/shot-keyframe/step.ts
 * 分镜关键帧出图执行器与原子 Step (首帧/尾帧关键帧生成并与镜头强绑定)
 */

import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { imageGenerateTool } from '../../../../../../tools/image-generate/image-generate.tool.js';
import { isAbortError } from '../../../../../../workflow-engine/run-context.js';
import type { FilmAdapterArtifact } from '../../../../../../project-store/contracts/film-production/film-spec.js';
import {
  ShotKeyframeInputSchema,
  ShotKeyframeOutputSchema,
  type ShotKeyframeInput,
  type ShotKeyframeOutput,
} from './schema.js';
import {
  buildShotKeyframePrompt,
  KEYFRAME_IMAGE_SIZE,
  KEYFRAME_NEGATIVE_PROMPT,
} from './prompt.js';

export async function renderShotKeyframe(
  input: ShotKeyframeInput
): Promise<ShotKeyframeOutput> {
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
    throw new Error(`[ShotKeyframe] 项目 [${projectId}] 缺少 film_spec 分镜切片清单`);
  }

  const clip = filmSpec.clips.find((c: any) => c.clipId === clipId);
  const shot = clip?.shots.find((s: any) => s.shotId === shotId);
  if (!clip || !shot) {
    throw new Error(`[ShotKeyframe] 未找到分镜镜头 [${clipId} · ${shotId}]`);
  }

  // 若用户手动调整了提示词，持久化回写至分镜首帧设定
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

  // 2. 收集本分镜绑定的场景底图、角色定妆立绘，并优先注入用户上传的参考图
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

    if (res?.success && res?.mediaUrl) {
      shot.firstFrameImageUrl = res.mediaUrl;
    }
  } catch (err: any) {
    if (isAbortError(err)) throw err;
    console.warn(`[ShotKeyframe] 镜头 [${shotId}] 首帧关键帧生成异常:`, err);
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
      if (lastRes?.success && lastRes?.mediaUrl) {
        shot.lastFrameImageUrl = lastRes.mediaUrl;
      }
    } catch (err: any) {
      if (isAbortError(err)) throw err;
      console.warn(`[ShotKeyframe] 镜头 [${shotId}] 尾帧关键帧生成异常:`, err);
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
}

export const shotKeyframeStep = createStep({
  id: 'step_cinema_shot_keyframe',
  description: '为分镜镜头生成高清首尾帧关键帧图片（点开分镜视频查看的关键帧图）',
  inputSchema: ShotKeyframeInputSchema,
  outputSchema: ShotKeyframeOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx;
    return await renderShotKeyframe(input);
  },
});
