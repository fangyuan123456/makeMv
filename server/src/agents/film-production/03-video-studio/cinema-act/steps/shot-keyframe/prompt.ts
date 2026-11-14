/**
 * agents/film-production/03-video-studio/cinema-act/steps/shot-keyframe/prompt.ts
 * 分镜关键帧生图提示词装配
 */

import type { CinematicShotOrder } from '../../../../../../project-store/contracts/film-production/film-spec.js';

export const KEYFRAME_IMAGE_SIZE = '1280*720';

export const KEYFRAME_NEGATIVE_PROMPT =
  '低分辨率，低画质，肢体畸形，多手多脚，画面过饱和，拼接，文字，水印，标签，边框，杂乱无章';

export function buildShotKeyframePrompt(shot: CinematicShotOrder): string {
  const base = shot.firstFramePrompt || `${shot.shotType} ${shot.cameraMovement}`;
  return `${base}，电影级实拍光影质感，构图讲究，细节丰富，专业电影摄影画幅。`;
}
