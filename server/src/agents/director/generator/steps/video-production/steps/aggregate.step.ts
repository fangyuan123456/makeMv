/**
 * agents/director/generator/steps/video-production/steps/aggregate.step.ts
 * 动态视频切片第 3 阶段原子 Step：视频切片聚合与持久化落盘
 */

import { createStep } from '@mastra/core/workflows';
import fs from 'fs';
import path from 'path';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';
import type { VideoClipItem, VideoProductionArtifact } from '../schema.js';

export const videoAggregateStep = createStep({
  id: 'step-video-aggregate',
  description: '将断点复用与新渲染视频切片归并，持久化写入 ProjectStore 与本地磁盘',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, payload } = context;
    const auditData = payload?.videoAudit;
    const renderedClips: VideoClipItem[] = payload?.videoRendered || [];

    if (!auditData) {
      throw new Error('[videoAggregateStep] 缺少前置核验上下文 (videoAudit)');
    }

    const {
      targetShotIds,
      cachedClips,
      keyframes,
    } = auditData;

    const store = ProjectStore.getInstance();
    const clipMap = new Map<string, VideoClipItem>();

    for (const c of cachedClips) {
      clipMap.set(c.shotId, c);
    }
    for (const c of renderedClips) {
      clipMap.set(c.shotId, c);
    }

    const finalClips: VideoClipItem[] = [];
    for (const kf of keyframes) {
      const c = clipMap.get(kf.shotId);
      if (c) {
        finalClips.push(c);
      }
    }

    const totalDuration = finalClips.reduce((acc, c) => acc + (c.durationSec || 3), 0);
    const isTargetRevision = Boolean(targetShotIds && targetShotIds.length > 0);

    const artifact: VideoProductionArtifact = {
      clips: finalClips,
      totalClips: keyframes.length,
      completedClips: finalClips.length,
      isRefinement: isTargetRevision,
      targetShotId: targetShotIds?.[0],
      totalDurationSec: totalDuration,
      createdAt: new Date().toISOString(),
    };

    store.setArtifact(projectId, WorkflowStage.VIDEO_PRODUCTION, artifact);
    exportVideoToLocalDisk(projectId, artifact);

    const resumeCount = cachedClips.length;
    const newCount = renderedClips.length;

    let summary = '';
    if (isTargetRevision) {
      summary = `🎬 分镜【${targetShotIds?.join('、')}】单镜靶向回退重绘完成并更新落盘！`;
    } else if (resumeCount > 0 && newCount > 0) {
      summary = `🎬 视频切片生产就绪（断点复用 ${resumeCount} 支，新渲染 ${newCount} 支，共 ${finalClips.length} 支，总时长 ${totalDuration} 秒）！`;
    } else if (resumeCount > 0 && newCount === 0) {
      summary = `🎬 全量 ${finalClips.length} 支视频切片均已在本地就绪（断点秒级全命中复用，总时长 ${totalDuration} 秒）！`;
    } else {
      summary = `🎬 全剧共 ${finalClips.length} 支高清动态视频切片批量渲染并落盘完毕 (总时长 ${totalDuration} 秒)！`;
    }

    return {
      ...context,
      toolResult: artifact,
      lastSummary: summary,
      success: true,
      data: artifact,
      summary,
    };
  },
});

function exportVideoToLocalDisk(projectId: string, artifact: VideoProductionArtifact) {
  try {
    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);
    const videoDir = path.join(projectDir, 'video');
    if (!fs.existsSync(videoDir)) {
      fs.mkdirSync(videoDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(videoDir, 'video_clips.json'),
      JSON.stringify(artifact, null, 2),
      'utf-8'
    );
  } catch (e) {
    console.warn('[videoAggregateStep] 本地磁盘落盘异常 (非致命):', e);
  }
}
