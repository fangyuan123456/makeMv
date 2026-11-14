/**
 * tools/film-production/07-shot-video-tool/steps/01-render/step.ts
 * 镜头视听渲染执行器与原子 Step (以关键帧为底驱动视频生成)
 */

import { createStep } from '@mastra/core/workflows';
import path from 'node:path';
import fs from 'node:fs';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { MediaResolver } from '../../../../../media/MediaResolver.js';
import { videoGenerateTool } from '../../../../video-generate/video-generate.tool.js';
import { isAbortError } from '../../../../../workflow-engine/run-context.js';
import type { FilmAdapterArtifact } from '../../../../../project-store/contracts/film-production/film-spec.js';
import {
  ShotVideoStepInputSchema,
  ShotVideoStepOutputSchema,
  type ShotVideoStepInput,
  type ShotVideoStepOutput,
} from './schema.js';
import { buildShotCinematographyPrompt } from './prompt.js';

export const shotVideoStep = createStep({
  id: 'render-shot-video',
  description: '以关键帧为底，驱动图生视频算力工具渲染带声画的镜头视频',
  inputSchema: ShotVideoStepInputSchema,
  outputSchema: ShotVideoStepOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as ShotVideoStepInput;
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
      throw new Error(`[ShotVideoTool] 项目 [${projectId}] 缺少 film_spec`);
    }

    const clip = filmSpec.clips?.find((c: any) => c.clipId === clipId);
    const shot = clip?.shots?.find((s: any) => s.shotId === shotId);
    if (!clip || !shot) {
      throw new Error(`[ShotVideoTool] 未找到分镜镜头 [${clipId} · ${shotId}]`);
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

    let keyframeUrl = referenceImageUrl || shot.firstFrameEnhancedUrl || shot.firstFrameImageUrl;
    if (!keyframeUrl) {
      // 物理磁盘自愈：尝试从 keyframes/ 目录自动检索落盘的首帧关键帧
      const projectDir = store.getProjectDir(projectId);
      const keyframeDir = path.resolve(projectDir, 'keyframes');
      if (fs.existsSync(keyframeDir)) {
        const files = fs.readdirSync(keyframeDir);
        const matched = files.find((f) => f.startsWith(`${shot.shotId}-first.`));
        if (matched) {
          keyframeUrl = MediaResolver.toMediaUrl(projectId, 'keyframes', matched);
          shot.firstFrameImageUrl = keyframeUrl;
        }
      }
    }

    if (!keyframeUrl) {
      throw new Error(`[ShotVideoTool] 镜头 [${shotId}] 尚未生成关键帧图，无法驱动视频生成`);
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

      if (!res?.success || !res?.videoUrl) {
        throw new Error(res?.error || '视频渲染未产出有效视频文件');
      }
      shot.videoUrl = res.videoUrl;
    } catch (err: any) {
      if (isAbortError(err)) throw err;
      throw new Error(`[ShotVideoTool] 镜头 [${shotId}] 视频渲染失败: ${err?.message || err}`);
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
      console.warn(`[ShotVideoTool] 同步分幕配置失败:`, err);
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
  },
});
