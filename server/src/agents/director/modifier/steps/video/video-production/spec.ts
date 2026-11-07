/**
 * agents/director/modifier/steps/video/video-production/spec.ts
 * 动态视频切片微调规格 (Video Production Modifier Spec)
 *
 * video 型：定位切片 → 推演运镜/动作参数 → 重新渲染视频 → 替换条目并落盘
 */

import { WorkflowStage } from '../../../../../../types/index.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import type {
  VideoProductionArtifact,
  VideoClipItem,
} from '../../../../../../artifacts/video-production.js';
import type { ModifierSpec, PhaseReporter } from '../../../spec.js';
import { extractUserFeedback } from '../../../spec.js';
import { planVideoClip, renderVideoClip, type VideoClipPlan } from './video-production.modifier.js';

interface VideoState {
  artifact: VideoProductionArtifact;
  targetIndex: number;
  target: VideoClipItem;
  extra: { kf: any; sbShot: any };
}

export const videoProductionSpec: ModifierSpec<VideoState, VideoClipPlan, VideoClipItem> = {
  key: 'video-production',
  title: '动态视频',
  kind: 'video',
  stage: WorkflowStage.VIDEO_PRODUCTION,

  load: async (ctx: any, report: PhaseReporter) => {
    const store = ProjectStore.getInstance();
    report(12, '读取视频切片产物…');

    const artifact = store.getArtifact<VideoProductionArtifact>(
      ctx.projectId,
      WorkflowStage.VIDEO_PRODUCTION
    );
    if (!artifact || !Array.isArray(artifact.clips) || artifact.clips.length === 0) {
      throw new Error(`项目 [${ctx.projectId}] 尚未生成动态视频切片，无法执行局部微调`);
    }

    const targetKey: string | undefined =
      ctx.payload?.targetShotId || ctx.payload?.target || ctx.target;
    const clips = [...artifact.clips];
    const targetIndex = targetKey
      ? clips.findIndex(
          (c) =>
            c.shotId?.toLowerCase() === targetKey.toLowerCase() ||
            c.clipId?.toLowerCase() === targetKey.toLowerCase() ||
            c.shotId?.includes(targetKey) ||
            targetKey.includes(c.shotId)
        )
      : 0;

    if (targetIndex < 0) {
      throw new Error(`未在已有视频切片中找到镜头【${targetKey}】`);
    }

    const existingClip = clips[targetIndex];
    const kfArtifact = store.getArtifact<any>(ctx.projectId, WorkflowStage.KEYFRAME_REFERENCE);
    // 关键帧产物的条目字段是 shots（不是 keyframes：keyframes 属于生成阶段的提示词推演结构）
    const kf = (kfArtifact?.shots || []).find((k: any) => k.shotId === existingClip.shotId) || {
      shotId: existingClip.shotId,
      imageUrl: existingClip.videoUrl,
    };

    const sbArtifact = store.getArtifact<any>(ctx.projectId, WorkflowStage.STORYBOARD);
    const sbShot = (sbArtifact?.shots || []).find((s: any) => s.shotId === existingClip.shotId);

    report(18, `已定位镜头【${existingClip.shotId}】`);
    return { artifact, targetIndex, target: existingClip, extra: { kf, sbShot } };
  },

  plan: async (state: VideoState, ctx: any, report: PhaseReporter): Promise<VideoClipPlan> => {
    report(28, '推演运镜与动作参数…');
    const payload = ctx.payload || {};
    const plan = await planVideoClip({
      projectId: ctx.projectId,
      kf: state.extra.kf,
      sbShot: state.extra.sbShot,
      existingClip: state.target,
      ratio: state.target.ratio || '16:9',
      resolution: state.target.resolution || '720P',
      cameraTrajectory: payload.cameraTrajectory,
      motionIntensity: payload.motionIntensity,
      userFeedback: extractUserFeedback(ctx),
      actionRevision: Boolean(payload.actionRevision),
      characterPrompt: payload.characterPrompt,
      isMock: Boolean(payload.isMock ?? ctx.overrideParams?.isMock),
    });
    report(40, '运镜参数推演完成');
    return plan;
  },

  apply: async (state: VideoState, plan: VideoClipPlan, ctx: any, report: PhaseReporter) => {
    report(50, `正在重新渲染镜头【${state.target.shotId}】视频…`);
    const rendered = await renderVideoClip(ctx.projectId, state.extra.kf, plan, {
      isMock: Boolean(ctx.payload?.isMock ?? ctx.overrideParams?.isMock),
    });
    report(90, '视频渲染完成');
    return rendered;
  },

  commit: async (state: VideoState, rendered: VideoClipItem, ctx: any, report: PhaseReporter) => {
    const clips = [...state.artifact.clips];
    clips[state.targetIndex] = rendered;
    const updated: VideoProductionArtifact = {
      ...state.artifact,
      clips,
      updatedAt: new Date().toISOString(),
    };
    ProjectStore.getInstance().setArtifact(ctx.projectId, WorkflowStage.VIDEO_PRODUCTION, updated);

    report(95, '已落盘');
    return {
      toolResult: updated,
      summary: `已完成镜头【${state.target.shotId}】的动态视频局部精修与运镜重做。全片其余 ${clips.length - 1} 个视频切片 100% 保持原状。`,
    };
  },
};
