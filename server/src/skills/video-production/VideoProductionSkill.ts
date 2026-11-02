/**
 * skills/video-production/VideoProductionSkill.ts
 * 动态视频切片生成技能包 (Video Production Skill SSOT)
 */

import fs from 'fs';
import path from 'path';
import { BaseSkill } from '../BaseSkill.js';
import type { SkillManifest, SkillContext } from '../types.js';
import { WorkflowStage } from '../../types/index.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { VisualMediaRenderer } from '../../media/VisualMediaRenderer.js';
import { asyncPool } from '../../utils/concurrency.js';

import {
  type VideoClipItem,
  type VideoProductionArtifact,
} from './schema.js';

export interface VideoProductionParams {
  userFeedback?: string;
  targetShotId?: string;
  isRefinement?: boolean;
  isMock?: boolean;
}

export { type VideoClipItem, type VideoProductionArtifact } from './schema.js';

export class VideoProductionSkill extends BaseSkill<VideoProductionParams, VideoProductionArtifact> {
  public readonly manifest: SkillManifest = {
    name: 'video-production',
    displayName: '动态视频切片批量生成与渲染',
    description: '将分镜头首帧参考图与运镜指令驱动转化为连贯动态高清视频切片',
    category: 'video',
    targetStage: WorkflowStage.VIDEO_PRODUCTION,
    parameters: {
      userFeedback: { type: 'string', description: '运镜幅度或动态细节调整' },
      targetShotId: { type: 'string', description: '指定单镜重做的镜头标识 (如 shot_3)' },
      isRefinement: { type: 'boolean', description: '是否属于对既有镜头视频的自愈微调重做' },
      isMock: { type: 'boolean', description: '是否为 Mock 模拟测试执行 (防扣费)' },
    },
  };

  protected async run(
    context: SkillContext<VideoProductionParams>
  ): Promise<{ data: VideoProductionArtifact; summary: string }> {
    const { projectId, params = {} } = context;
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);

    await this.notifyProgress(context, 15, '正在调取各分镜头首帧画面与机位运镜参数...');

    const kfArtifact = store.getArtifact<any>(projectId, WorkflowStage.KEYFRAME_REFERENCE);
    const keyframes = kfArtifact?.shots || [];

    if (keyframes.length === 0) {
      throw new Error('缺少前序关键帧数据，请先执行前置工序【关键帧图】');
    }

    const sbArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
    const shotsMap = new Map<string, any>();
    for (const s of sbArtifact?.shots || []) {
      shotsMap.set(s.shotId, s);
    }

    const targetShotId = params.targetShotId;
    const keyframesToProcess = targetShotId
      ? keyframes.filter((k: any) => k.shotId === targetShotId)
      : keyframes;

    if (keyframesToProcess.length === 0) {
      throw new Error(`未在关键帧资产中找到指定渲染的目标镜头 [${targetShotId}]`);
    }

    await this.notifyProgress(
      context,
      50,
      targetShotId
        ? `正在靶向渲染指定镜头 [${targetShotId}] 动态视频切片...`
        : `正在批量渲染生成 ${keyframesToProcess.length} 支动态视频切片...`
    );

    const ratio = project?.meta?.videoRatio || '16:9';
    const resolution = project?.meta?.videoResolution || '720P';

    // 🌟 3路并发控制与原子断点落盘 (仅渲染待处理镜头 keyframesToProcess)
    const newlyRenderedClips = await asyncPool<any, VideoClipItem>(
      3,
      keyframesToProcess,
      async (kf: any) => {
        const sbShot = shotsMap.get(kf.shotId);
        const duration = sbShot?.durationSec || 3;
        const clipId = `clip_${kf.shotId}`;

        // 🌟 物理渲染并透传 isMock 标记防御扣费
        const physicalVideoUrl = await VisualMediaRenderer.renderVideoClip(
          projectId,
          clipId,
          kf.shotId,
          duration,
          resolution,
          ratio,
          sbShot?.visualComposition || kf.prompt,
          kf.imageUrl,
          { isMock: params.isMock }
        );

        return {
          clipId,
          shotId: kf.shotId,
          videoUrl: physicalVideoUrl,
          durationSec: duration,
          resolution,
          ratio,
          status: 'rendered',
        };
      },
      (completed, total, item) => {
        const percent = 50 + Math.round((completed / total) * 45);
        this.notifyProgress(context, percent, `正在并发渲染动态视频切片 (${completed}/${total}): ${item.clipId}`);
      }
    );

    // 🌟 靶向单镜视频微调与增量合并 (按 shotId 替换保全既有资产)
    const existingArtifact = store.getArtifact<VideoProductionArtifact>(projectId, WorkflowStage.VIDEO_PRODUCTION);
    let mergedClips: VideoClipItem[] = [];

    if (targetShotId && existingArtifact && Array.isArray(existingArtifact.clips)) {
      const updateMap = new Map(newlyRenderedClips.map((c) => [c.shotId, c]));
      mergedClips = existingArtifact.clips.map((oldClip) => updateMap.get(oldClip.shotId) || oldClip);
      for (const freshClip of newlyRenderedClips) {
        if (!mergedClips.some((c) => c.shotId === freshClip.shotId)) {
          mergedClips.push(freshClip);
        }
      }
    } else {
      mergedClips = newlyRenderedClips;
    }

    const totalDuration = mergedClips.reduce((acc, c) => acc + (c.durationSec || 0), 0);

    const artifact: VideoProductionArtifact = {
      clips: mergedClips,
      totalClips: mergedClips.length,
      completedClips: mergedClips.filter((c) => c.videoUrl).length,
      totalDurationSec: totalDuration,
      isRefinement: Boolean(targetShotId || params.isRefinement),
      targetShotId,
      createdAt: existingArtifact?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 写入状态黑板 (SSOT)
    store.setArtifact(projectId, WorkflowStage.VIDEO_PRODUCTION, artifact);

    if (project) {
      store.saveProject(project);
    }

    // 本地持久化
    this.exportToLocalDisk(projectId, artifact);

    const summary = targetShotId
      ? `🎯 镜头 [${targetShotId}] 动态视频切片靶向渲染完成！已与全片既有视频片段增量合并保全。`
      : `🎥 全剧 ${artifact.completedClips} 支动态视频切片批量渲染完成！总时长 ${artifact.totalDurationSec} 秒，画质 ${resolution} (${ratio}) 已锁定。`;

    return {
      data: artifact,
      summary,
    };
  }

  private exportToLocalDisk(projectId: string, artifact: VideoProductionArtifact): void {
    try {
      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(projectId);
      const videoDir = path.join(projectDir, 'video');
      if (!fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(videoDir, 'video_production.json'),
        JSON.stringify(artifact, null, 2),
        'utf-8'
      );

      let md = `# 全剧动态视频切片生产清单 (Video Clips Catalog)\n\n> **生成时间**: ${artifact.createdAt}\n> **切片总数**: ${artifact.completedClips} 个\n> **视频总时长**: ${artifact.totalDurationSec} 秒\n\n---\n\n`;
      for (const c of artifact.clips) {
        md += `### 视频切片 [${c.clipId}] (对应分镜: ${c.shotId})\n`;
        md += `* **文件路径**: \`${c.videoUrl}\`\n`;
        md += `* **时长/规格**: ${c.durationSec} 秒 · ${c.resolution} · ${c.ratio}\n\n`;
      }

      fs.writeFileSync(path.join(videoDir, 'video_production.md'), md, 'utf-8');
    } catch (err) {
      console.warn('[VideoProductionSkill] 本地落盘警告:', err);
    }
  }
}
