/**
 * tools/film-production/shot-video-tool/steps/01-render/step.ts
 * 镜头视听渲染执行器与原子 Step (支持单镜头与全剧批量两栖执行)
 */

import { createStep } from '@mastra/core/workflows';
import path from 'node:path';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { atomicWriteJsonSync } from '../../../../../utils/atomicFile.js';
import {
  appendVideoVersion,
  buildShotMediaFileName,
  readVideoVersions,
} from '../../../../../project-store/shot-frame-versions.js';
import { videoGenerateTool } from '../../../../media/video-generate.tool.js';
import { isAbortError } from '../../../../../workflow-engine/run-context.js';
import type { FilmAdapterArtifact } from '../../../../../project-store/contracts/film-production/film-spec.js';
import {
  ShotVideoStepInputSchema,
  ShotVideoStepOutputSchema,
  type ShotVideoStepInput,
  type ShotVideoStepOutput,
} from './schema.js';
import { formatVideoMotionPrompt } from './prompt.js';

export const shotVideoStep = createStep({
  id: 'render-shot-video',
  description: '以关键帧为底，驱动图生视频算力工具渲染带声画的镜头视频 (支持单镜头重制与全剧批量续跑)',
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
      throw new Error(`[ShotVideoTool] 项目 [${projectId}] 缺少 film_spec 分镜切片清单`);
    }

    const projectDir = store.getProjectDir(projectId);

    // 单镜头视频渲染闭包
    const renderSingleVideo = async (targetClip: any, targetShot: any): Promise<boolean> => {
      if (customPrompt && customPrompt.trim()) {
        targetShot.videoPrompt = customPrompt.trim();
      }

      const isCustomRedo = Boolean(customPrompt || referenceImageUrl);
      if (targetShot.videoUrl && !force && !isCustomRedo) {
        return true;
      }

      // 底图确定性源头：优先使用显式参考图；若未显式指定，优先选用首帧版本库中最新超分高清图，杜绝低清底图污染
      let effectiveImage = referenceImageUrl;
      if (!effectiveImage) {
        const firstVersions = Array.isArray(targetShot.firstFrameVersions) ? targetShot.firstFrameVersions : [];
        const latestUpscale = [...firstVersions].reverse().find((v: any) => v.source === 'upscale' && v.imageUrl);
        effectiveImage = latestUpscale?.imageUrl || targetShot.firstFrameImageUrl || targetShot.keyframeUrl;
      }
      if (!effectiveImage) {
        console.warn(`[ShotVideoTool] 镜头 [${targetShot.shotId}] 缺少前序关键帧底图，跳过视频渲染`);
        return false;
      }

      const effectiveLastFrame = targetShot.lastFrameImageUrl || targetShot.lastFrameUrl || undefined;

      // 业务层纯提示词：自定义优先，否则沿用镜头台本（保持纯戏剧台本，绝不存硬件外壳）
      if (customPrompt && customPrompt.trim()) {
        targetShot.videoPrompt = customPrompt.trim();
      }
      const rawMotion =
        targetShot.videoPrompt ||
        `${targetShot.cameraMovement || '中速稳健运镜'}, 电影级平滑物理运镜，人物动作流畅写实，自然物理速率`;

      // 底层算力硬件提示词（动态装配，仅内存态传给视频生成工具，绝不写回 targetShot 业务实体）
      const hardwarePrompt = formatVideoMotionPrompt(rawMotion, Boolean(effectiveLastFrame));
      const audioPrompt = targetShot.audioPrompt || targetShot.ambience || '电影级写实环境声与质感氛围';

      const targetDuration = Math.min(10, Math.max(2, Math.round(targetShot.durationSec || 4)));

      const existingVersions = readVideoVersions(targetShot);
      const nextSeq = existingVersions.length + 1;
      const motionTag = targetShot.motionDirective?.presetId || targetShot.motionDirective?.label || 'dolly';
      const { fileName } = buildShotMediaFileName({
        shotId: targetShot.shotId,
        kind: 'video',
        continuityMode: targetShot.continuityMode || 'auto',
        visualOrMotionTag: motionTag,
        versionSeq: nextSeq,
        ext: '.mp4',
      });

      try {
        const res: any = await (videoGenerateTool.execute as any)({
          context: {
            projectId,
            prompt: hardwarePrompt,
            audioPrompt,
            referenceImageUrl: effectiveImage,
            lastFrameImageUrl: effectiveLastFrame,
            duration: targetDuration,
            subfolder: 'videos',
            customFilename: fileName.replace(/\.[^.]+$/, ''),
          },
        });

        const mediaUrl = res?.mediaUrl || res?.videoUrl;
        if (!res?.success || !mediaUrl) {
          throw new Error(res?.error || '视频算力未产出有效媒体地址');
        }

        targetShot.videoUrl = mediaUrl;
        appendVideoVersion(targetShot, {
          videoUrl: mediaUrl,
          fileName,
          prompt: targetShot.videoPrompt,
          continuityMode: targetShot.continuityMode || 'auto',
          motionDirective: targetShot.motionDirective,
          dynamicDirective: targetShot.dynamicDirective,
          focusDirective: targetShot.focusDirective,
          source: 'generate',
        });

        // 同步至分镜画布节点
        const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
        if (canvas?.nodes) {
          let updatedCanvas = false;
          for (const node of Object.values<any>(canvas.nodes)) {
            if (node.shotId !== targetShot.shotId && node.id !== `node_${targetShot.shotId}`) continue;
            node.videoUrl = mediaUrl;
            node.videoVersions = targetShot.videoVersions;
            if (targetShot.motionDirective !== undefined) node.motionDirective = targetShot.motionDirective;
            if (targetShot.dynamicDirective !== undefined) node.dynamicDirective = targetShot.dynamicDirective;
            if (targetShot.focusDirective !== undefined) node.focusDirective = targetShot.focusDirective;
            updatedCanvas = true;
          }
          if (updatedCanvas) {
            store.setArtifact(projectId, 'storyboard_canvas', canvas);
            atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), canvas);
          }
        }

        return true;
      } catch (err: any) {
        if (isAbortError(err)) throw err;
        throw new Error(`[ShotVideoTool] 镜头 [${targetShot.shotId}] 视频渲染失败: ${err?.message || err}`);
      }
    };

    // 1. 若未提供 shotId，开启全剧批量模式 (遍历全剧已有关键帧但无视频的镜头)
    if (!shotId) {
      const allShotPairs: Array<{ clip: any; shot: any }> = [];
      for (const c of filmSpec.clips || []) {
        for (const s of c.shots || []) {
          allShotPairs.push({ clip: c, shot: s });
        }
      }

      let renderedCount = 0;
      for (const pair of allShotPairs) {
        const hasKeyframe = Boolean(pair.shot.firstFrameImageUrl || pair.shot.keyframeUrl);
        if (hasKeyframe && (force || !pair.shot.videoUrl)) {
          const success = await renderSingleVideo(pair.clip, pair.shot);
          if (success) renderedCount++;
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

    // 2. 提供了 shotId，单镜头定向重制模式 (全局反查，无需外部显式提供 clipId)
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
      throw new Error(`[ShotVideoTool] 未在全剧分镜中找到镜头 [${shotId}]`);
    }

    await renderSingleVideo(matchedClip, matchedShot);

    // 单体落盘与同步
    store.setArtifact(projectId, 'film_spec', filmSpec);
    store.setArtifact(projectId, 'storyboards', filmSpec.clips);
    atomicWriteJsonSync(path.join(projectDir, 'storyboards.json'), filmSpec.clips);

    return {
      projectId,
      clipId: matchedClip.clipId,
      shotId: matchedShot.shotId,
      videoUrl: matchedShot.videoUrl,
      reused: false,
      success: Boolean(matchedShot.videoUrl),
    };
  },
});
