/**
 * tools/film-production/lookdev-tool/location/prompt.ts
 * 场景空镜定妆提示词规范 (Scene Lookdev Prompt SSOT)
 */

import type { GlobalEntities } from '../../../../project-store/contracts/film-production/lookdev.js';

export const SCENE_ATMOSPHERE_SIZE = '1280*720';

export const SCENE_ATMOSPHERE_NEGATIVE =
  '人物，人像，人脸，人体，手部，背影，人群，剧情动作，文字，水印，标签，边框，拼贴，分格线，低分辨率，低画质，画面过饱和';

/**
 * 组装场景空镜渲染提示词（单一事实来源 SSOT）：
 * 1. location.promptZh 为全场景唯一合法的生图物理描述（融合空间透视、核心地标与主光影）；
 * 2. spatialLayout 提供地标关系，promptZh 提供材质与风格，两者共同约束出图；
 * 3. 严格控制在 150~250 字符黄金注意窗口，模型注意力高度聚焦于空间形制与光影质感。
 */
export function buildSceneAtmospherePrompt(
  location: GlobalEntities['locations'][number],
  artStyle: string,
  hasReferenceImage = false
): string {
  const coreContent = (location.promptZh || location.appearanceSummary || location.name || '场景空间')
    .trim()
    .replace(/[，,。；;]+$/, '');
  const cleanArtStyle = artStyle?.trim() ? `画风：${artStyle.trim()}。` : '';
  const layout = location.spatialLayout?.trim()
    ? `空间布局依据：${location.spatialLayout.trim()}。按此布局安排入口与地标，不机械照搬参考图中冲突的位置。`
    : '';

  if (!hasReferenceImage) {
    return `${coreContent}。${layout}纯空间无人物，材质与光影服从指定画风，无文字无水印。${cleanArtStyle}`.trim();
  }

  return `参考 <image1> 的环境外观：${coreContent}。${layout}纯空间无人物，材质与光影服从指定画风，无文字无水印。${cleanArtStyle}`.trim();
}
