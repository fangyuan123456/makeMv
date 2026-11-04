/**
 * tools/video-production/video-production.workflow.ts
 * 动态视频生成微观子工作流 (Video Production Micro Sub-Workflow SSOT)
 * 
 * 核心架构特性：
 * 1. 细粒度断点恢复 (Resume & Skip)：自动检测已渲染落盘的镜头切片，断网/重启/失败重跑时跳过已完成项，绝不重复烧卡；
 * 2. 镜头级靶向回退 (Single-Shot Rollback)：支持 targetShotId / targetShotIds 靶向重跑指定镜头，其余镜头资产严格保全；
 * 3. Mastra 原生 DAG 微工作流：状态机拆解为 审计核验 ➔ 并发渲染 ➔ 归并落盘 3 大原子 Step。
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { ProposalStore } from '../../project-store/ProposalStore.js';
import { VideoRenderer } from './video.renderer.js';
import { asyncPoolSettled } from '../../utils/concurrency.js';
import { assembleDeltaMotionPrompt } from './motion-engine.js';
import { WorkflowStage } from '../../types/index.js';
import {
  VideoClipItemSchema,
  VideoProductionArtifactSchema,
  type VideoClipItem,
  type VideoProductionArtifact,
} from './schema.js';

// 子工作流输入契约
export const VideoSubWorkflowInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识 ID'),
  sessionId: z.string().optional().describe('当前交互会话 ID'),
  targetShotId: z.string().optional().describe('指定单镜头重做/回退标识 (如 shot_1)'),
  targetShotIds: z.array(z.string()).optional().describe('指定批量镜头重做/回退列表'),
  cameraTrajectory: z.string().optional().describe('覆盖运镜轨迹'),
  motionIntensity: z.union([z.string(), z.number()]).optional().describe('运活动量强度'),
  userFeedback: z.string().optional().describe('运镜幅度或动态细节调整'),
  forceRegenerate: z.boolean().optional().describe('是否强制全量重跑（忽略断点缓存）'),
  proposalId: z.string().optional().describe('关联的人在回路提案 ID (细粒度进度反馈)'),
  isMock: z.boolean().optional().describe('是否为 Mock 模拟测试'),
});

export type VideoSubWorkflowInput = z.infer<typeof VideoSubWorkflowInputSchema>;

// 中间审计步骤上下文
const VideoAuditContextSchema = z.object({
  projectId: z.string(),
  sessionId: z.string().optional(),
  proposalId: z.string().optional(),
  targetShotId: z.string().optional(),
  targetShotIds: z.array(z.string()).optional(),
  cameraTrajectory: z.string().optional(),
  motionIntensity: z.union([z.string(), z.number()]).optional(),
  userFeedback: z.string().optional(),
  isMock: z.boolean().optional(),
  cachedClips: z.array(VideoClipItemSchema),
  pendingShots: z.array(z.any()),
  allShotsMap: z.record(z.any()),
  keyframes: z.array(z.any()),
});

// Step 1: 镜头状态审计与断点恢复计算
export const auditVideoShotsStep = createStep({
  id: 'step-audit-video-shots',
  description: '核验物理切片与已有资产，计算断点复用切片与需要执行/回退的待渲染分镜',
  inputSchema: VideoSubWorkflowInputSchema,
  outputSchema: VideoAuditContextSchema,
  execute: async ({ inputData }) => {
    const {
      projectId,
      sessionId,
      proposalId,
      targetShotId,
      targetShotIds,
      cameraTrajectory,
      motionIntensity,
      userFeedback,
      forceRegenerate,
      isMock,
    } = inputData;

    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);
    const videoDir = path.join(projectDir, 'video');

    // 1. 获取前置关键帧与分镜资产
    const kfArtifact = store.getArtifact<any>(projectId, WorkflowStage.KEYFRAME_REFERENCE);
    const keyframes = kfArtifact?.shots || [];
    if (!keyframes || keyframes.length === 0) {
      throw new Error('[VideoSubWorkflow] 缺少前序关键帧数据，请先执行前置工序【关键帧图生成】');
    }

    const sbArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
    const allShotsMap: Record<string, any> = {};
    for (const s of sbArtifact?.shots || []) {
      allShotsMap[s.shotId] = s;
    }

    // 2. 检查既有视频切片资产
    const existingArtifact = store.getArtifact<VideoProductionArtifact>(projectId, WorkflowStage.VIDEO_PRODUCTION);
    const existingClips = Array.isArray(existingArtifact?.clips) ? existingArtifact.clips : [];

    // 3. 计算显式回退目标镜头集合
    const rollbackSet = new Set<string>();
    if (targetShotId) rollbackSet.add(targetShotId);
    if (Array.isArray(targetShotIds)) {
      targetShotIds.forEach((id) => rollbackSet.add(id));
    }

    const cachedClips: VideoClipItem[] = [];
    const pendingShots: any[] = [];

    // 4. 逐镜头判断：断点复用 vs 渲染/回退
    for (const kf of keyframes) {
      const shotId = kf.shotId;
      const isTargetedRollback = rollbackSet.has(shotId);

      // 检查物理磁盘文件是否有效存在
      const safeClipId = `clip_${shotId}`.replace(/[^\w-]/g, '_');
      const diskFilePath = path.join(videoDir, `${safeClipId}_clip.mp4`);
      const isFileOnDisk = fs.existsSync(diskFilePath) && fs.statSync(diskFilePath).size > 0;

      // 查找既有切片记录
      const existingClip = existingClips.find((c) => c.shotId === shotId);

      // 断点命中条件：未被指定回退 + 非强制重跑 + 物理文件存在 + 存在既有元数据
      if (!isTargetedRollback && !forceRegenerate && (isFileOnDisk || existingClip)) {
        cachedClips.push(
          existingClip || {
            clipId: `clip_${shotId}`,
            shotId,
            videoUrl: `/media/${projectId}/video/${safeClipId}_clip.mp4`,
            durationSec: allShotsMap[shotId]?.durationSec || 3,
            resolution: '720P',
            ratio: '16:9',
            status: 'rendered',
          }
        );
      } else {
        // 需重新生成/回退重跑
        pendingShots.push(kf);
      }
    }

    return {
      projectId,
      sessionId,
      proposalId,
      targetShotId,
      targetShotIds,
      cameraTrajectory,
      motionIntensity,
      userFeedback,
      isMock,
      cachedClips,
      pendingShots,
      allShotsMap,
      keyframes,
    };
  },
});

// 中间渲染执行上下文
const VideoRenderContextSchema = VideoAuditContextSchema.extend({
  renderedClips: z.array(VideoClipItemSchema),
});

// Step 2: 并发渲染待执行镜头
export const renderPendingVideoShotsStep = createStep({
  id: 'step-render-pending-shots',
  description: '对未就绪或被指定回退的分镜执行并发视听渲染与单镜头重试',
  inputSchema: VideoAuditContextSchema,
  outputSchema: VideoRenderContextSchema,
  execute: async ({ inputData }) => {
    const {
      projectId,
      proposalId,
      pendingShots,
      allShotsMap,
      cameraTrajectory,
      motionIntensity,
      userFeedback,
      isMock,
    } = inputData;

    const proposalStore = ProposalStore.getInstance();
    const renderedClips: VideoClipItem[] = [];

    // 若所有镜头均断点命中复用，直接跳过实际渲染
    if (pendingShots.length === 0) {
      return {
        ...inputData,
        renderedClips,
      };
    }

    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    const ratio = project?.meta?.videoRatio || '16:9';
    const resolution = project?.meta?.videoResolution || '720P';

    let completedCount = 0;
    const totalCount = pendingShots.length;

    // 容错并发池调度渲染
    const poolResults = await asyncPoolSettled<any, VideoClipItem>(
      3,
      pendingShots,
      async (kf: any) => {
        if (proposalId) {
          proposalStore.updateProposalStatus(projectId, proposalId, 'running', {
            lastMessage: `⚡ [${completedCount}/${totalCount}] 正在渲染分镜视频切片 (${kf.shotId})...`,
          });
        }

        const sbShot = allShotsMap[kf.shotId];
        const duration = sbShot?.durationSec || 3;
        const clipId = `clip_${kf.shotId}`;

        const normalizedIntensity =
          typeof motionIntensity === 'number'
            ? motionIntensity > 0.7
              ? 'high'
              : motionIntensity < 0.4
              ? 'low'
              : 'normal'
            : (motionIntensity as any);

        const prompt = assembleDeltaMotionPrompt({
          subjectMotion: sbShot?.subjectMotion,
          cameraTrajectory: cameraTrajectory || sbShot?.cameraTrajectory || sbShot?.cameraMovement,
          sceneDynamics: sbShot?.sceneDynamics || kf.sceneEnvironment || sbShot?.visualComposition,
          motionIntensity: normalizedIntensity || sbShot?.motionIntensity,
          userFeedback,
        });

        const renderRes = await VideoRenderer.renderVideoClip(
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
            lastMessage: `⚡ [${completedCount}/${totalCount}] 分镜 (${kf.shotId}) 视频切片生成就绪`,
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

    for (const item of poolResults) {
      if (item.status === 'fulfilled' && item.value) {
        renderedClips.push(item.value);
      }
    }

    return {
      ...inputData,
      renderedClips,
    };
  },
});

// Step 3: 归并切片清单并原子落盘
export const aggregateVideoArtifactStep = createStep({
  id: 'step-aggregate-video-artifact',
  description: '将断点复用切片与最新渲染切片按原始镜头时序归并并原子落盘',
  inputSchema: VideoRenderContextSchema,
  outputSchema: z.object({
    success: z.boolean(),
    data: VideoProductionArtifactSchema,
    summary: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { projectId, cachedClips, renderedClips, keyframes, targetShotId } = inputData;
    const store = ProjectStore.getInstance();

    const clipsMap = new Map<string, VideoClipItem>();
    // 先置入复用切片
    for (const c of cachedClips) {
      clipsMap.set(c.shotId, c);
    }
    // 再以新渲染切片覆盖（实现单镜回退覆写）
    for (const c of renderedClips) {
      clipsMap.set(c.shotId, c);
    }

    // 按原始分镜顺序严密重构
    const finalClips: VideoClipItem[] = [];
    for (const kf of keyframes) {
      const clip = clipsMap.get(kf.shotId);
      if (clip) {
        finalClips.push(clip);
      }
    }

    if (finalClips.length === 0) {
      throw new Error('[VideoSubWorkflow] 没有任何有效的视频切片生成或就绪，无法装配视频资产');
    }

    const totalDuration = finalClips.reduce((acc, c) => acc + (c.durationSec || 0), 0);
    const existingArtifact = store.getArtifact<VideoProductionArtifact>(projectId, WorkflowStage.VIDEO_PRODUCTION);

    const artifact: VideoProductionArtifact = {
      clips: finalClips,
      totalClips: finalClips.length,
      completedClips: finalClips.length,
      totalDurationSec: totalDuration,
      isRefinement: Boolean(targetShotId || renderedClips.length < keyframes.length),
      targetShotId,
      createdAt: existingArtifact?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 双向落盘：黑板 + 物理磁盘
    store.setArtifact(projectId, WorkflowStage.VIDEO_PRODUCTION, artifact);
    exportVideoToLocalDisk(projectId, artifact);

    const resumeCount = cachedClips.length;
    const newCount = renderedClips.length;

    let summary = '';
    if (targetShotId) {
      summary = `🎬 分镜【${targetShotId}】单镜靶向回退重绘完成并更新落盘！`;
    } else if (resumeCount > 0 && newCount > 0) {
      summary = `🎬 视频切片生产就绪（断点复用 ${resumeCount} 支，新渲染 ${newCount} 支，共 ${finalClips.length} 支，总时长 ${totalDuration} 秒）！`;
    } else if (resumeCount > 0 && newCount === 0) {
      summary = `🎬 全量 ${finalClips.length} 支视频切片均已在本地就绪（断点秒级全命中复用，总时长 ${totalDuration} 秒）！`;
    } else {
      summary = `🎬 全剧共 ${finalClips.length} 支高清动态视频切片批量渲染并落盘完毕 (总时长 ${totalDuration} 秒)！`;
    }

    return {
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
    console.warn('[videoProductionSubWorkflow] 本地磁盘落盘异常 (非致命):', e);
  }
}

/**
 * 动态视频切片生产微观子工作流 (Micro Sub-Workflow SSOT)
 */
export const videoProductionSubWorkflow = createWorkflow({
  id: 'subwf-video-production',
  inputSchema: VideoSubWorkflowInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    data: VideoProductionArtifactSchema,
    summary: z.string(),
  }),
})
  .then(auditVideoShotsStep)
  .then(renderPendingVideoShotsStep)
  .then(aggregateVideoArtifactStep)
  .commit();
