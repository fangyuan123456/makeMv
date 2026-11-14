/**
 * agents/film-production/03-video-studio/lookdev/steps/prop-lookdev/prompt.ts
 */

import type { GlobalEntities } from '../../../../../../project-store/contracts/film-production/lookdev.js';

export const PROP_LOOKDEV_SIZE = '1024*1024';

export const PROP_LOOKDEV_NEGATIVE =
  '低分辨率，低画质，文字，水印，标签，边框，拼贴，分格线，人物，手部，手指，多件物品，杂乱背景，室内街景';

export function buildPropLookdevPrompt(
  item: GlobalEntities['items'][number],
  artStyle: string
): string {
  const base = item.promptZh || item.appearanceSummary;
  return `核心道具特写，单件居中静物摄影：${base}。细节特征：${item.appearanceSummary}。纯中性浅灰无缝工作室背景，正面均匀柔光，无杂物无人物无手指，无文字无标签无水印。${artStyle}`;
}
