/**
 * tools/film-production/05-scene-atmosphere-tool/steps/01-render/prompt.ts
 */

import type { GlobalEntities } from '../../../../../project-store/contracts/film-production/lookdev.js';

export const SCENE_ATMOSPHERE_SIZE = '1280*720';

export const SCENE_ATMOSPHERE_NEGATIVE =
  '人物，人像，人脸，人体，手部，背影，人群，剧情动作，文字，水印，标签，边框，拼贴，分格线，低分辨率，低画质，画面过饱和';

export function buildSceneAtmospherePrompt(
  location: GlobalEntities['locations'][number],
  artStyle: string
): string {
  const base = location.promptZh || location.appearanceSummary;
  return `纯场景无人广角空镜，电影级构图：${base}。空间与环境光影：${location.appearanceSummary}。画面中绝对没有任何人物，纯建筑与自然空间，真实光学景深，电影摄影质感。${artStyle}`;
}
