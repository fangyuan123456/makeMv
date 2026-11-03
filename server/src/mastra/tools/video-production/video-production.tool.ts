/**
 * mastra/tools/video-production/video-production.tool.ts
 * Mastra 原生 Tool: 动态视频切片生成与单镜头重绘自愈 (Video Production Tool SSOT)
 * 
 * 核心机制：
 * 1. 意图 100% 透传：结合首帧基准图与分镜运镜描述驱动生成；
 * 2. 容错并发池 (Partial Success Persistence)：单镜渲染异常不影响已渲染完成切片；
 * 3. 产物双向落盘：ProjectStore SSOT 状态黑板 + 本地工程 video/ 物理文件；
 * 4. 支持 targetShotId 单镜靶向自愈重做与人在回路 requireApproval: true。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { ProposalStore } from '../../../project-store/ProposalStore.js';
import { VisualMediaRenderer } from '../../../media/VisualMediaRenderer.js';
import { asyncPoolSettled } from '../../../utils/concurrency.js';
import { assembleDeltaMotionPrompt } from '../../../knowledge/motion-dialects.js';
import { WorkflowStage } from '../../../types/index.js';
import {
  VideoProductionArtifactSchema,
  type VideoClipItem,
  type VideoProductionArtifact,
} from './schema.js';

export const videoProductionTool = createTool({
  id: 'video-production-generator',
  description: '将分镜头首帧参考图与运镜指令驱动转化为连贯动态高清视频切片，支持单镜头靶向微调自愈',
  inputSchema: z.object({
    projectId: z.string().describe('项目全局唯一 ID (Project ID)'),
    sessionId: z.string().optional().describe('当前交互会话 ID'),
    targetShotId: z.string().optional().describe('指定单镜重做的镜头标识 (如 shot_1)'),
    cameraTrajectory: z.string().optional().describe('覆盖运镜轨迹 (如 pan_left, orbit, zoom_in 等)'),
    motionIntensity: z.union([z.string(), z.number()]).optional().describe('运活动量强度 (如 low, normal, high 或数值)'),
    userFeedback: z.string().optional().describe('运镜幅度或动态细节调整'),
    proposalId: z.string().optional().describe('关联的人在回路提案 ID (细粒度进度反馈 SSOT)'),
    isMock: z.boolean().optional().describe('是否为 Mock 模拟测试'),
  }).strict(),
  outputSchema: z.object({
    success: z.boolean(),
    data: VideoProductionArtifactSchema.optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  requireApproval: true,
  execute: async (params) => {
    try {
      const { projectId, targetShotId, cameraTrajectory, motionIntensity, userFeedback, proposalId, isMock } = params;
      const store = ProjectStore.getInstance();
      const proposalStore = ProposalStore.getInstance();
      const project = store.getProject(projectId);

      const kfArtifact = store.getArtifact<any>(projectId, WorkflowStage.KEYFRAME_REFERENCE);
      const keyframes = kfArtifact?.shots || [];

      if (!keyframes || keyframes.length === 0) {
        throw new Error('缺少前序关键帧数据，请先执行前置工序【关键帧图生成】');
      }

      const sbArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
      const shotsMap = new Map<string, any>();
      for (const s of sbArtifact?.shots || []) {
        shotsMap.set(s.shotId, s);
      }

      const existingArtifact = store.getArtifact<VideoProductionArtifact>(projectId, WorkflowStage.VIDEO_PRODUCTION);

      if (targetShotId && (!existingArtifact || !Array.isArray(existingArtifact.clips) || existingArtifact.clips.length === 0)) {
        throw new Error('当前项目尚无既有视频切片资产，无法执行单镜头靶向微调，请先执行全量视频生成');
      }

      const keyframesToProcess = targetShotId
        ? keyframes.filter((k: any) => k.shotId === targetShotId)
        : keyframes;

      if (keyframesToProcess.length === 0) {
        throw new Error(`未在关键帧资产中找到指定渲染的目标镜头 [${targetShotId}]`);
      }

      const ratio = project?.meta?.videoRatio || '16:9';
      const resolution = project?.meta?.videoResolution || '720P';

      let completedCount = 0;
      const totalCount = keyframesToProcess.length;

      // 容错并发池执行视频切片渲染
      const poolResults = await asyncPoolSettled<any, VideoClipItem>(
        3,
        keyframesToProcess,
        async (kf: any) => {
          if (proposalId) {
            proposalStore.updateProposalStatus(projectId, proposalId, 'running', {
              lastMessage: `⚡ [${completedCount}/${totalCount}] 正在渲染分镜视频切片 (${kf.shotId})...`,
            });
          }

          const sbShot = shotsMap.get(kf.shotId);
          const duration = sbShot?.durationSec || 3;
          const clipId = `clip_${kf.shotId}`;
          // 采用 OpenMontage 纯动量时序增量组装 (方案 A 源头结构化物理隔离，彻底断绝静态长相污染)
          const normalizedIntensity = typeof motionIntensity === 'number'
            ? (motionIntensity > 0.7 ? 'high' : motionIntensity < 0.4 ? 'low' : 'normal')
            : (motionIntensity as any);

          const prompt = assembleDeltaMotionPrompt({
            subjectMotion: sbShot?.subjectMotion,
            cameraTrajectory: cameraTrajectory || sbShot?.cameraTrajectory || sbShot?.cameraMovement,
            sceneDynamics: sbShot?.sceneDynamics || kf.sceneEnvironment || sbShot?.visualComposition,
            motionIntensity: normalizedIntensity || sbShot?.motionIntensity,
            userFeedback,
          });

          const renderRes = await VisualMediaRenderer.renderVideoClip(
            projectId,
            clipId,
            kf.shotId,
            duration,
            resolution,
            ratio,
            prompt,
            kf.imageUrl,
            { isMock }
          );

          completedCount++;
          if (proposalId) {
            proposalStore.updateProposalStatus(projectId, proposalId, 'running', {
              lastMessage: `⚡ [${completedCount}/${totalCount}] 分镜 (${kf.shotId}) 视频渲染完成`,
            });
          }

          return {
            clipId,
            shotId: kf.shotId,
            videoUrl: renderRes.url,
            durationSec: duration,
            resolution,
            ratio,
            status: 'rendered',
            isDegraded: renderRes.isDegraded,
            degradedReason: renderRes.degradedReason,
          };
        }
      );

      const successfulClips: VideoClipItem[] = [];
      const failedShots: string[] = [];

      for (let i = 0; i < poolResults.length; i++) {
        const item = poolResults[i];
        if (item.status === 'fulfilled' && item.value) {
          successfulClips.push(item.value);
        } else {
          failedShots.push(keyframesToProcess[i].shotId);
        }
      }

      if (successfulClips.length === 0) {
        throw new Error('所有视频切片渲染均未成功，请检查视频服务凭据或网络配置');
      }

      let finalClips: VideoClipItem[] = [];
      if (targetShotId && existingArtifact) {
        finalClips = existingArtifact.clips.map((oldClip) => {
          const updated = successfulClips.find((c) => c.shotId === oldClip.shotId);
          return (updated || oldClip) as VideoClipItem;
        });
      } else {
        finalClips = successfulClips;
      }

      const totalDuration = finalClips.reduce((acc, c) => acc + (c.durationSec || 0), 0);

      const artifact: VideoProductionArtifact = {
        clips: finalClips,
        totalClips: finalClips.length,
        completedClips: finalClips.length,
        totalDurationSec: totalDuration,
        isRefinement: Boolean(targetShotId),
        targetShotId,
        createdAt: existingArtifact?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.setArtifact(projectId, WorkflowStage.VIDEO_PRODUCTION, artifact);
      exportToLocalDisk(projectId, artifact);

      const summary = targetShotId
        ? `🎬 镜头【${targetShotId}】动态视频重绘完成并锁定落盘！`
        : `🎬 全剧共 ${finalClips.length} 支高清动态视频切片批量渲染并落盘完毕 (总时长 ${totalDuration} 秒)！`;

      return {
        success: true,
        data: artifact,
        summary,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || '动态视频生成失败',
      };
    }
  },
});

function exportToLocalDisk(projectId: string, artifact: VideoProductionArtifact) {
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
    console.warn('[videoProductionTool] 本地磁盘落盘异常 (非致命):', e);
  }
}
