/**
 * agents/film-production/03-video-studio/cinema-act/act-shot.workflow.ts
 * 单幕分镜视频子工作流 (Act Shot Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import type {
  FilmAdapterArtifact,
  CinematicClipOrder,
  CinematicShotOrder,
} from '../../../../project-store/contracts/film-production/film-spec.js';
import {
  renderShotKeyframe,
  shotKeyframeStep,
} from './steps/shot-keyframe/index.js';
import {
  renderShotCinematography,
  shotCinematographyStep,
} from './steps/shot-cinematography/index.js';

export interface ActShotWorkflowResult {
  clipId: string;
  shots: CinematicShotOrder[];
  completedCount: number;
  totalCount: number;
}

/**
 * 动态组装单幕分镜镜头子工作流实例 (Mastra 原生 Workflow)
 */
export function createActShotWorkflow(projectId: string, clip: CinematicClipOrder): Workflow {
  const triggerSchema = z.object({
    projectId: z.string(),
    clipId: z.string(),
    forceKeyframe: z.boolean().default(false),
    forceVideo: z.boolean().default(false),
  });

  const wf = new Workflow({
    name: `act_shot_workflow_${projectId}_${clip.clipId}`,
    triggerSchema,
  });

  let builder: any = wf.step(shotKeyframeStep);
  builder = builder.then(shotCinematographyStep);

  return builder.commit();
}

/**
 * 单幕分镜视频子工作流高阶执行器
 */
export async function executeActShotWorkflow(params: {
  projectId: string;
  clipId: string;
  forceKeyframe?: boolean;
  forceVideo?: boolean;
  onProgress?: (note: string, percent: number) => void;
}): Promise<ActShotWorkflowResult> {
  const { projectId, clipId, forceKeyframe = false, forceVideo = false, onProgress } = params;
  const store = ProjectStore.getInstance();
  const filmSpec = store.getArtifact<FilmAdapterArtifact>(projectId, 'film_spec');

  if (!filmSpec) {
    throw new Error(`[ActShotWorkflow] 项目 [${projectId}] 缺少 film_spec 分镜切片清单`);
  }

  const clip = filmSpec.clips.find((c) => c.clipId === clipId);
  if (!clip) {
    throw new Error(`[ActShotWorkflow] 未找到分幕 [${clipId}]`);
  }

  const shots = clip.shots || [];
  const total = shots.length;
  let completed = 0;

  for (let i = 0; i < total; i++) {
    const shot = shots[i];
    const shotTitle = `[${clipId} · 镜头 ${i + 1}/${total}] ${shot.shotId}`;

    // 1. 生成或复用关键帧首帧图 (Keyframe Image)
    onProgress?.(`正在确立关键帧图：${shotTitle}...`, Math.round(((i + 0.2) / total) * 100));
    await renderShotKeyframe({
      projectId,
      clipId,
      shotId: shot.shotId,
      force: forceKeyframe,
    });

    // 2. 依据关键帧图渲染镜头动态视频 (Shot Video)
    onProgress?.(`正在渲染分镜视频：${shotTitle}...`, Math.round(((i + 0.6) / total) * 100));
    const videoRes = await renderShotCinematography({
      projectId,
      clipId,
      shotId: shot.shotId,
      force: forceVideo,
    });

    if (videoRes.success) completed++;
    onProgress?.(`分镜镜头已就绪：${shotTitle}`, Math.round(((i + 1) / total) * 100));
  }

  const updatedSpec = store.getArtifact<FilmAdapterArtifact>(projectId, 'film_spec')!;
  const updatedClip = updatedSpec.clips.find((c) => c.clipId === clipId)!;

  return {
    clipId,
    shots: updatedClip.shots,
    completedCount: completed,
    totalCount: total,
  };
}

/**
 * 单分镜镜头渲染原子执行器 (包含关键帧确立与视频渲染，支持点开关键帧大图查看)
 */
export async function renderSingleShot(params: {
  projectId: string;
  clipId: string;
  shotId: string;
  forceKeyframe?: boolean;
  forceVideo?: boolean;
}) {
  const { projectId, clipId, shotId, forceKeyframe = false, forceVideo = false } = params;
  const keyframeRes = await renderShotKeyframe({
    projectId,
    clipId,
    shotId,
    force: forceKeyframe,
  });
  const videoRes = await renderShotCinematography({
    projectId,
    clipId,
    shotId,
    force: forceVideo,
  });
  return {
    success: keyframeRes.success && videoRes.success,
    keyframe: keyframeRes,
    video: videoRes,
  };
}
