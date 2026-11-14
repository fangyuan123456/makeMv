/**
 * agents/film-production/03-video-studio/cinema-act/steps/shot-cinematography/step.ts
 * 镜头视听渲染执行器与原子 Step (以关键帧为底驱动视频生成)
 */

import { createStep } from '@mastra/core/workflows';
import path from 'node:path';
import fs from 'node:fs';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { videoGenerateTool } from '../../../../../../tools/video-generate/video-generate.tool.js';
import { isAbortError } from '../../../../../../workflow-engine/run-context.js';
import type { FilmAdapterArtifact } from '../../../../../../project-store/contracts/film-production/film-spec.js';
import {
  ShotCinematographyInputSchema,
  ShotCinematographyOutputSchema,
  type ShotCinematographyInput,
  type ShotCinematographyOutput,
} from './schema.js';
import { buildShotCinematographyPrompt } from './prompt.js';

export async function renderShotCinematography(
  input: ShotCinematographyInput
): Promise<ShotCinematographyOutput> {
  const {
    projectId,
    clipId,
    shotId,
    force = false,
    customPrompt,
    referenceImageUrl,
  } = input;
  const store = ProjectStore.getInstance();
  const filmSpec = store.getArtifact<FilmAdapterArtifact>(projectId, 'film_spec');

  if (!filmSpec) {
    throw new Error(`[ShotCinematography] 项目 [${projectId}] 缺少 film_spec`);
  }

  const clip = filmSpec.clips.find((c: any) => c.clipId === clipId);
  const shot = clip?.shots.find((s: any) => s.shotId === shotId);
  if (!clip || !shot) {
    throw new Error(`[ShotCinematography] 未找到分镜镜头 [${clipId} · ${shotId}]`);
  }

  // 若用户手动调整了动作表演提示词，持久化回写
  if (customPrompt && customPrompt.trim()) {
    shot.videoPrompt = customPrompt.trim();
  }

  // 1. 若已有视频且无自定义调整并不强制重新渲染，直接复用
  const isCustomRedo = Boolean(customPrompt || referenceImageUrl);
  if (shot.videoUrl && !force && !isCustomRedo) {
    return {
      projectId,
      clipId,
      shotId,
      videoUrl: shot.videoUrl,
      reused: true,
      success: true,
    };
  }

  const keyframeUrl = referenceImageUrl || shot.firstFrameEnhancedUrl || shot.firstFrameImageUrl;
  if (!keyframeUrl) {
    throw new Error(`[ShotCinematography] 镜头 [${shotId}] 尚未生成关键帧图，无法驱动视频生成`);
  }

  const defaultPrompts = buildShotCinematographyPrompt(shot);
  const prompt = customPrompt && customPrompt.trim() ? customPrompt.trim() : defaultPrompts.videoPrompt;
  const audioPrompt = defaultPrompts.audioPrompt;

  try {
    const res: any = await (videoGenerateTool.execute as any)({
      context: {
        projectId,
        prompt,
        audioPrompt,
        referenceImageUrl: keyframeUrl,
        lastFrameImageUrl: shot.generationMode === 'first_last_frame'
          ? (shot.lastFrameEnhancedUrl || shot.lastFrameImageUrl)
          : undefined,
        duration: shot.durationSec,
        subfolder: 'video',
        customFilename: shot.shotId,
      },
    });

    if (res?.success && res?.videoUrl) {
      shot.videoUrl = res.videoUrl;
    }
  } catch (err: any) {
    if (isAbortError(err)) throw err;
    console.warn(`[ShotCinematography] 镜头 [${shotId}] 视频渲染异常:`, err);
  }

  // 2. 更新 scenes/<clipId>.json 供游戏端直接消费
  try {
    const projectDir = store.getProjectDir(projectId);
    const scenePath = path.join(projectDir, 'scenes', `${clipId}.json`);
    if (fs.existsSync(scenePath)) {
      const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
      if (shot.videoUrl && clip.shots.length === 1) {
        scene.videoUrl = shot.videoUrl;
      }
      fs.writeFileSync(scenePath, JSON.stringify(scene, null, 2));
    }
  } catch (err) {
    console.warn(`[ShotCinematography] 同步分幕配置失败:`, err);
  }

  store.setArtifact(projectId, 'film_spec', filmSpec);

  return {
    projectId,
    clipId,
    shotId,
    videoUrl: shot.videoUrl,
    reused: false,
    success: Boolean(shot.videoUrl),
  };
}

export const shotCinematographyStep = createStep({
  id: 'step_cinema_shot_cinematography',
  description: '以关键帧为底，驱动图生视频算力工具渲染带声画的镜头视频',
  inputSchema: ShotCinematographyInputSchema,
  outputSchema: ShotCinematographyOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx;
    return await renderShotCinematography(input);
  },
});
