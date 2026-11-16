/**
 * tools/film-production/03-character-portrait-tool/steps/01-render/prompt.ts
 * 角色立绘定妆提示词规范 (Character Portrait Prompt SSOT)
 */

import type { GlobalEntities } from '../../../../../project-store/contracts/film-production/lookdev.js';

export const CHARACTER_PORTRAIT_SIZE = '768*1344';

export const CHARACTER_PORTRAIT_NEGATIVE =
  '低分辨率，低画质，肢体畸形，手指畸形，多手多脚，画面过饱和，大跨步，迈步，双腿大开，奔跑，跳跃，行走动态，大幅歪头，偏头，斜视，大侧脸，大侧身，扭身，弯腰，下蹲，夸张动态动作，剧烈姿势，手遮挡面部，手遮挡胸口，文字，水印，标签，边框，拼贴，分格线，多个人物，场景背景，街景，室外场景，半身裁切';

export function buildCharacterPortraitPrompt(
  character: GlobalEntities['characters'][number],
  artStyle: string,
  hasReferenceImage = false
): string {
  const base = character.promptZh || character.appearanceSummary;
  const standardLookdevPose =
    '好莱坞工业级角色全身定妆照，单人正面端正直立自然站姿，身体重心垂直居中无倾斜，双脚自然平稳着地无跨步，双手自然垂放放松无遮挡，头部端正不偏斜，双眼水平正视镜头前方，全身完整入镜从头到脚完整可见。纯浅灰中性无缝摄影棚背景，柔和影视三点光，无杂乱背景元素，无文字无标签无水印。';

  if (!hasReferenceImage) {
    return `${standardLookdevPose} 角色设定与精细骨相外貌：${base}。服装细节锁定：${character.appearanceSummary}。真实电影写实摄影质感与细腻皮肤织物纹理。${artStyle}`;
  }
  return `${standardLookdevPose} 以 <image1> 为参考基模，最大程度精准继承图中的人物相貌、五官特征、发型肤色与气质，身穿${character.appearanceSummary}。外貌设定锁定：${base}。真实电影写实摄影质感与细腻皮肤织物纹理。${artStyle}`;
}
