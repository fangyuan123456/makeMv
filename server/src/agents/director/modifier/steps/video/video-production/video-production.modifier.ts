/**
 * agents/director/modifier/steps/video/video-production/video-production.modifier.ts
 * 动态视频单镜靶向动态调优与运镜/动作重做引擎 (Video Production Modifier SSOT)
 */

import { VideoRenderer } from '../../../../../../media/index.js';
import {
  assembleDeltaMotionPrompt,
  breakdownActionKeyPoses,
  assemblePoseGuidedMotionPrompt,
} from '../../../../../../media/motion-engine.js';
import type {
  VideoClipItem,
  KeyPoseItem,
} from '../../../../../../artifacts/video-production.js';

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

export interface VideoClipPlan {
  clipId: string;
  duration: number;
  resolution: string;
  ratio: string;
  prompt: string;
  keyPoses?: KeyPoseItem[];
  renderMode: 'direct_i2v' | 'pose_breakdown';
  characterPrompt?: string;
}

/** 推演渲染参数（可能含一次 LLM 动作解构），不触碰任何资产与聚合根 */
export async function planVideoClip(options: ModifyVideoClipOptions): Promise<VideoClipPlan> {
  const {
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

  const effectiveTrajectory = cameraTrajectory || sbShot?.cameraTrajectory || sbShot?.cameraMovement;

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

  return {
    clipId,
    duration,
    resolution,
    ratio,
    prompt,
    keyPoses: resolvedKeyPoses,
    renderMode,
    characterPrompt: characterPrompt || existingClip?.characterPrompt,
  };
}

/** 按推演参数渲染视频切片，不触碰聚合根 */
export async function renderVideoClip(
  projectId: string,
  kf: any,
  plan: VideoClipPlan,
  options?: { isMock?: boolean }
): Promise<VideoClipItem> {
  const isMock = options?.isMock ?? false;
  const renderRes = await VideoRenderer.renderVideoClip(
    projectId,
    plan.clipId,
    kf.shotId,
    plan.duration,
    plan.resolution,
    plan.ratio,
    plan.prompt,
    kf.imageUrl,
    { isMock }
  );

  return {
    clipId: plan.clipId,
    shotId: kf.shotId,
    videoUrl: renderRes.url,
    durationSec: plan.duration,
    resolution: plan.resolution,
    ratio: plan.ratio,
    status: 'rendered' as const,
    isDegraded: renderRes.isDegraded,
    degradedReason: renderRes.degradedReason,
    keyPoses: plan.keyPoses,
    renderMode: plan.renderMode,
    characterPrompt: plan.characterPrompt,
  };
}
