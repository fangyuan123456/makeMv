/**
 * agents/pipeline/workflows/steps/video-production/generator.ts
 * 动态视频切片全新批量渲染引擎 (Video Production Generator SSOT)
 */

import { VideoRenderer } from '../../../../../media/index.js';
import { assembleDeltaMotionPrompt } from './motion-engine.js';
import type { VideoClipItem } from './schema.js';

export interface RenderFreshVideoClipOptions {
  projectId: string;
  kf: any;
  sbShot?: any;
  ratio?: string;
  resolution?: string;
  cameraTrajectory?: string;
  motionIntensity?: string | number;
  userFeedback?: string;
  isMock?: boolean;
}

export async function renderFreshVideoClip(
  options: RenderFreshVideoClipOptions
): Promise<VideoClipItem> {
  const {
    projectId,
    kf,
    sbShot,
    ratio = '16:9',
    resolution = '720P',
    cameraTrajectory,
    motionIntensity,
    userFeedback,
    isMock = false,
  } = options;

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
  };
}
