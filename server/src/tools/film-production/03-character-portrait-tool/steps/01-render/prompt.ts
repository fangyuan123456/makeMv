/**
 * tools/film-production/03-character-portrait-tool/steps/01-render/prompt.ts
 * 角色立绘定妆提示词规范 (Character Portrait Prompt SSOT)
 */

import type { GlobalEntities } from '../../../../../project-store/contracts/film-production/lookdev.js';

export const CHARACTER_PORTRAIT_SIZE = '768*1344';

export const CHARACTER_PORTRAIT_NEGATIVE =
  '低分辨率，低画质，肢体畸形，手指畸形，多手多脚，画面过饱和，文字，水印，标签，边框，拼贴，分格线，多个人物，场景背景，街景，室外场景，半身裁切';

export function buildCharacterPortraitPrompt(
  character: GlobalEntities['characters'][number],
  artStyle: string
): string {
  const base = character.promptZh || character.appearanceSummary;
  return `角色定妆照，单人正面全身站姿，双脚着地，五官清晰：${base}。外貌细节锁定：${character.appearanceSummary}。纯中性浅灰无缝工作室背景，画面中只有这一个人，正面均匀柔光，低对比度，无硬边阴影，无文字无标签无水印。${artStyle}`;
}
