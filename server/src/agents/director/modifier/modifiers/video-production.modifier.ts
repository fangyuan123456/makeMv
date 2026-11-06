/**
 * agents/modifier/modifiers/video-production.modifier.ts
 * 动态视频单镜靶向动态调优与运镜/动作重做引擎 (Video Production Modifier SSOT)
 */

import { VideoRenderer } from '../../../../media/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../types/index.js';
import {
  assembleDeltaMotionPrompt,
  breakdownActionKeyPoses,
  assemblePoseGuidedMotionPrompt,
} from '../../generator/steps/video-production/motion-engine.js';
import type {
  VideoClipItem,
  VideoProductionArtifact,
  KeyPoseItem,
} from '../../generator/steps/video-production/schema.js';

export interface ModifyVideoClipOptions {
  projectId: string;
  kf: any;
  sbShot?: any;
  existingClip?: VideoClipItem;
  ratio?: string;
  resolution?: string;
  cameraTrajectory?: string;
  motionIntensity?: string | number;
  userFeedback?: string;
  isMock?: boolean;
  actionRevision?: boolean;
  characterPrompt?: string;
  keyPoses?: KeyPoseItem[];
}

export async function modifyVideoClip(
  options: ModifyVideoClipOptions
): Promise<VideoClipItem> {
  const {
    projectId,
    kf,
    sbShot,
    existingClip,
    ratio = '16:9',
    resolution = '720P',
    cameraTrajectory,
    motionIntensity,
    userFeedback,
    isMock = false,
    actionRevision = false,
    characterPrompt,
    keyPoses,
  } = options;

  const duration = sbShot?.durationSec || existingClip?.durationSec || 3;
  const clipId = existingClip?.clipId || `clip_${kf.shotId}`;

  const effectiveTrajectory =
    cameraTrajectory ||
    sbShot?.cameraTrajectory ||
    sbShot?.cameraMovement;

  const normalizedIntensity =
    typeof motionIntensity === 'number'
      ? motionIntensity > 0.7
        ? 'high'
        : motionIntensity < 0.4
        ? 'low'
        : 'normal'
      : (motionIntensity as any) || sbShot?.motionIntensity;

  let resolvedKeyPoses: KeyPoseItem[] | undefined = keyPoses;
  let renderMode: 'direct_i2v' | 'pose_breakdown' = 'direct_i2v';

  if (actionRevision || (resolvedKeyPoses && resolvedKeyPoses.length > 0)) {
    renderMode = 'pose_breakdown';
    if (!resolvedKeyPoses || resolvedKeyPoses.length === 0) {
      resolvedKeyPoses = await breakdownActionKeyPoses({
        shotId: kf.shotId,
        subjectMotion: sbShot?.subjectMotion,
        userFeedback,
        durationSec: duration,
        isMock,
      });
    }
  } else if (existingClip?.keyPoses && existingClip.keyPoses.length > 0) {
    resolvedKeyPoses = existingClip.keyPoses;
    renderMode = existingClip.renderMode || 'pose_breakdown';
  }

  const baseMotionInput = {
    subjectMotion: sbShot?.subjectMotion,
    cameraTrajectory: effectiveTrajectory,
    sceneDynamics: sbShot?.sceneDynamics || kf.sceneEnvironment || sbShot?.visualComposition,
    motionIntensity: normalizedIntensity,
    userFeedback,
    characterPrompt: characterPrompt || existingClip?.characterPrompt,
  };

  const prompt =
    renderMode === 'pose_breakdown' && resolvedKeyPoses && resolvedKeyPoses.length > 0
      ? assemblePoseGuidedMotionPrompt(resolvedKeyPoses, baseMotionInput)
      : assembleDeltaMotionPrompt(baseMotionInput);

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

  return {
    clipId,
    shotId: kf.shotId,
    videoUrl: renderRes.url,
    durationSec: duration,
    resolution,
    ratio,
    status: 'rendered' as const,
    isDegraded: renderRes.isDegraded,
    degradedReason: renderRes.degradedReason,
    keyPoses: resolvedKeyPoses,
    renderMode,
    characterPrompt: characterPrompt || existingClip?.characterPrompt,
  };
}

export interface ModifyVideoProductionOptions {
  projectId: string;
  targetShotId?: string;
  userFeedback: string;
  actionRevision?: boolean;
  cameraTrajectory?: string;
  motionIntensity?: string | number;
  characterPrompt?: string;
  isMock?: boolean;
}

export interface ModifyVideoProductionResult {
  success: boolean;
  data?: VideoProductionArtifact;
  summary?: string;
  error?: string;
}

export async function modifyVideoProduction(
  options: ModifyVideoProductionOptions
): Promise<ModifyVideoProductionResult> {
  const {
    projectId,
    targetShotId,
    userFeedback,
    actionRevision,
    cameraTrajectory,
    motionIntensity,
    characterPrompt,
    isMock,
  } = options;
  const store = ProjectStore.getInstance();
  const existingArtifact = store.getArtifact<VideoProductionArtifact>(
    projectId,
    WorkflowStage.VIDEO_PRODUCTION
  );

  if (!existingArtifact || !Array.isArray(existingArtifact.clips) || existingArtifact.clips.length === 0) {
    return {
      success: false,
      error: `项目 [${projectId}] 尚未生成动态视频切片，无法执行局部微调`,
    };
  }

  const clips = [...existingArtifact.clips];
  const targetIndex = targetShotId
    ? clips.findIndex(
        (c) =>
          c.shotId?.toLowerCase() === targetShotId.toLowerCase() ||
          c.clipId?.toLowerCase() === targetShotId.toLowerCase() ||
          c.shotId?.includes(targetShotId) ||
          targetShotId.includes(c.shotId)
      )
    : 0;

  if (targetIndex < 0) {
    return {
      success: false,
      error: `未在已有视频切片中找到镜头【${targetShotId}】`,
    };
  }

  const existingClip = clips[targetIndex];
  const kfArtifact = store.getArtifact<any>(projectId, WorkflowStage.KEYFRAME_REFERENCE);
  const kf = (kfArtifact?.keyframes || []).find((k: any) => k.shotId === existingClip.shotId) || {
    shotId: existingClip.shotId,
    imageUrl: existingClip.videoUrl,
  };

  const sbArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
  const sbShot = (sbArtifact?.shots || []).find((s: any) => s.shotId === existingClip.shotId);

  // 1. 单点重新生成该镜头视频切片
  const updatedClip = await modifyVideoClip({
    projectId,
    kf,
    sbShot,
    existingClip,
    ratio: existingClip.ratio || '16:9',
    resolution: existingClip.resolution || '720P',
    cameraTrajectory,
    motionIntensity,
    userFeedback,
    actionRevision,
    characterPrompt,
    isMock,
  });

  // 2. 单点替换目标切片，其余切片 100% 物理保全
  clips[targetIndex] = updatedClip;

  const updatedArtifact: VideoProductionArtifact = {
    ...existingArtifact,
    clips,
    updatedAt: new Date().toISOString(),
  };

  store.setArtifact(projectId, WorkflowStage.VIDEO_PRODUCTION, updatedArtifact);

  return {
    success: true,
    data: updatedArtifact,
    summary: `已完成镜头【${existingClip.shotId}】的动态视频局部精修与运镜重做。全片其余 ${clips.length - 1} 个视频切片 100% 保持原状。`,
  };
}
