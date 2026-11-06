/**
 * agents/director/generator/steps/video-production/steps/audit.step.ts
 * 动态视频切片第 1 阶段原子 Step：核验视频切片断点与待渲染分镜
 */

import { createStep } from '@mastra/core/workflows';
import fs from 'fs';
import path from 'path';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';
import type { VideoClipItem, VideoProductionArtifact } from '../schema.js';

export const videoAuditStep = createStep({
  id: 'step-video-audit',
  description: '核验物理切片与已有资产，计算断点复用切片与待渲染分镜',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, payload } = context;

    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);
    const videoDir = path.join(projectDir, 'video');

    const kfArtifact = store.getArtifact<any>(projectId, WorkflowStage.KEYFRAME_REFERENCE);
    const keyframes = kfArtifact?.shots || [];
    if (!keyframes || keyframes.length === 0) {
      throw new Error('[videoAuditStep] 缺少前序关键帧数据，请先执行前置工序【关键帧图生成】');
    }

    const sbArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
    const allShotsMap: Record<string, any> = {};
    for (const s of sbArtifact?.shots || []) {
      allShotsMap[s.shotId] = s;
    }

    const existingArtifact = store.getArtifact<VideoProductionArtifact>(projectId, WorkflowStage.VIDEO_PRODUCTION);
    const existingClips = Array.isArray(existingArtifact?.clips) ? existingArtifact.clips : [];

    const targetShotIds: string[] | undefined =
      (context as any).targetShotIds ||
      payload?.targetShotIds ||
      ((context as any).targetShotId ? [(context as any).targetShotId] : undefined) ||
      (payload?.targetShotId ? [payload.targetShotId] : undefined);

    const rollbackSet = new Set<string>(targetShotIds || []);
    const forceRegenerate = Boolean((context as any).forceRegenerate || payload?.forceRegenerate);
    const isMock = Boolean((context as any).isMock || payload?.isMock);

    const cachedClips: VideoClipItem[] = [];
    const pendingShots: any[] = [];

    for (const kf of keyframes) {
      const isTargetRollback = rollbackSet.has(kf.shotId);
      const existingClip = existingClips.find((c) => c.shotId === kf.shotId);

      let isPhysicalFileValid = false;
      if (existingClip?.videoUrl) {
        if (isMock) {
          isPhysicalFileValid = true;
        } else if (existingClip.videoUrl.startsWith(`/media/${projectId}/`)) {
          const relPath = existingClip.videoUrl.replace(`/media/${projectId}/`, '');
          const absPath = path.join(projectDir, relPath);
          isPhysicalFileValid = fs.existsSync(absPath) && fs.statSync(absPath).size > 0;
        } else {
          const legacyAbsPath = path.join(videoDir, `clip_${kf.shotId}.mp4`);
          isPhysicalFileValid = fs.existsSync(legacyAbsPath) && fs.statSync(legacyAbsPath).size > 0;
        }
      }

      if (!forceRegenerate && !isTargetRollback && existingClip && isPhysicalFileValid) {
        cachedClips.push(existingClip);
      } else {
        pendingShots.push(kf);
      }
    }

    return {
      ...context,
      payload: {
        ...(payload || {}),
        videoAudit: {
          targetShotIds,
          cameraTrajectory: (context as any).cameraTrajectory || payload?.cameraTrajectory,
          motionIntensity: (context as any).motionIntensity || payload?.motionIntensity,
          userFeedback: (context as any).userFeedback || payload?.userFeedback || context.feedback,
          isMock,
          cachedClips,
          pendingShots,
          allShotsMap,
          keyframes,
        },
      },
      lastSummary: `视频切片核验完成：全剧 ${keyframes.length} 个镜头，断点秒级复用 ${cachedClips.length} 支，待渲染 ${pendingShots.length} 支。`,
    };
  },
});
