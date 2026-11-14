/**
 * tools/film-production/07-shot-video-tool/steps/01-render/prompt.ts
 * 镜头视频动作表演与音效提示词装配
 */

import type { CinematicShotOrder } from '../../../../../project-store/contracts/film-production/film-spec.js';

export function buildShotCinematographyPrompt(shot: CinematicShotOrder): {
  videoPrompt: string;
  audioPrompt: string;
} {
  const videoPrompt = shot.videoPrompt || `${shot.cameraMovement}, cinematic motion, smooth natural action`;
  const audioPrompt = shot.audioPrompt || shot.ambience || 'cinematic sound atmosphere';
  return { videoPrompt, audioPrompt };
}
