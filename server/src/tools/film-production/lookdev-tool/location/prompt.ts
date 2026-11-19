/**
 * tools/film-production/lookdev-tool/location/prompt.ts
 */

import type { GlobalEntities } from '../../../../project-store/contracts/film-production/lookdev.js';

export const SCENE_ATMOSPHERE_SIZE = '1280*720';

export const SCENE_ATMOSPHERE_NEGATIVE =
  '人物，人像，人脸，人体，手部，背影，人群，剧情动作，文字，水印，标签，边框，拼贴，分格线，低分辨率，低画质，画面过饱和';

export function buildSceneAtmospherePrompt(
  location: GlobalEntities['locations'][number],
  artStyle: string,
  hasReferenceImage = false
): string {
  const base = location.promptZh || location.appearanceSummary;
  if (!hasReferenceImage) {
    return `电影级场景空间概念设计，专业空间纵深与时空光影：${base}。空间氛围与环境细节设定：${location.appearanceSummary}。画面中绝对无人无角色，纯建筑、自然与环境陈设空间，真实物理光学景深与材质肌理，电影摄影级光影对比与独特色彩基调，无文字无标签无水印。${artStyle}`;
  }
  return `电影级场景空间概念设计，以 <image1> 为参考底图，在符合时空环境设定的前提下，最大程度继承图中的空间结构、建筑轮廓与环境氛围基调：${base}。环境细节：${location.appearanceSummary}。画面中绝对无人无角色，纯空间场景，真实光学景深与电影级质感，无文字无标签无水印。${artStyle}`;
}
