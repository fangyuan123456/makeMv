/**
 * tools/film-production/lookdev-tool/item/prompt.ts
 * 道具特写定妆提示词规范 (Prop Lookdev Prompt SSOT)
 */

import type { GlobalEntities } from '../../../../project-store/contracts/film-production/lookdev.js';

export const PROP_LOOKDEV_SIZE = '1024*1024';

// 纯单体实物资产定妆负向词：排除场景背景、环境杂物与人手干扰，保持单体纯粹性
export const PROP_LOOKDEV_NEGATIVE =
  '低分辨率，低画质，文字，水印，标签，边框，拼贴，分格线，人物，人像，手部，手指，多件物品，场景环境，杂乱背景，室外街景，室内建筑，地面泥土';

/**
 * 影视工业级单体道具棚拍统摄后缀 (Isolated Prop Catalog Suffix SSOT)
 */
export const PROP_ISOLATED_CATALOG_SUFFIX =
  '单件独立道具居中特写，纯浅灰中性无缝摄影棚背景，三点式静物柔光与边缘轮廓光，微距对焦真实物理材质与工艺细节，无杂物无人物无多余环境。';

/**
 * 组装道具特写定妆渲染提示词（单一事实来源 SSOT）：
 * 1. item.promptZh 为核心实物资产唯一合法的生图物理描述；
 * 2. 避免同时拼接 promptZh 与 appearanceSummary 导致材质复读；
 * 3. 结合 PROP_ISOLATED_CATALOG_SUFFIX 统摄单体无缝棚拍规范。
 */
export function buildPropLookdevPrompt(
  item: GlobalEntities['items'][number],
  artStyle: string
): string {
  const coreContent = (item.promptZh || item.appearanceSummary || '')
    .trim()
    .replace(/[，,。；;]+$/, '');
  const cleanStyle = artStyle?.trim() ? `画风：${artStyle.trim()}。` : '';
  return `核心道具实物资产特写：${coreContent}。${PROP_ISOLATED_CATALOG_SUFFIX}无文字无标签无水印。${cleanStyle}`.trim();
}
