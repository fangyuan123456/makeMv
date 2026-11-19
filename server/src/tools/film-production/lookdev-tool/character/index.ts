import type { RenderProfile } from '../render.js';
import {
  appendCharacterThreeViewLock,
  applyCharacterPoseConstraint,
  buildCharacterPortraitPrompt,
  CHARACTER_PORTRAIT_NEGATIVE,
  CHARACTER_PORTRAIT_SIZE,
} from './prompt.js';

export const characterProfile: RenderProfile = {
  idKey: 'characterId',
  subfolder: 'assets/entities',
  size: CHARACTER_PORTRAIT_SIZE,
  mode: (hasReference) => hasReference ? 'character_three_view' : 'character_t2i',
  reference: (entity, isEdit) =>
    (isEdit || entity.promptZh?.includes('<image1>')) && entity.imageUrl
      ? entity.imageUrl : entity.referenceImageUrl,
  prompt: async (entity, artStyle, hasReference, target, edit) => {
    const customPrompt = target.customPrompt?.trim();
    const directedEdit = edit?.directedPrompt?.trim();
    const poseConstraint = target.poseConstraint || edit?.poseConstraint || entity.poseConstraint;

    // 1. 显式传入完整角色设定 customPrompt（哪怕带参考图），一律经 buildCharacterPortraitPrompt 强制挂载三视图排版规范
    if (customPrompt) {
      return applyCharacterPoseConstraint({
        text: buildCharacterPortraitPrompt({ ...entity, promptZh: customPrompt } as any, artStyle, hasReference),
        negative: [target.customNegativePrompt || edit?.negativePrompt, CHARACTER_PORTRAIT_NEGATIVE].filter(Boolean).join('，'),
        savedPrompt: customPrompt,
      }, poseConstraint);
    }

    // 2. 基于 instruction 编译出的图生图差分指令：强制锚定三视图构图锁定，绝不退化为单人像
    if (directedEdit && hasReference) {
      return applyCharacterPoseConstraint({
        text: appendCharacterThreeViewLock(directedEdit),
        negative: [target.customNegativePrompt || edit?.negativePrompt, CHARACTER_PORTRAIT_NEGATIVE].filter(Boolean).join('，'),
      }, poseConstraint);
    }

    // 3. 标准角色三视图生成
    return applyCharacterPoseConstraint({
      text: buildCharacterPortraitPrompt(entity as any, artStyle, hasReference),
      negative: [target.customNegativePrompt || edit?.negativePrompt, CHARACTER_PORTRAIT_NEGATIVE].filter(Boolean).join('，'),
    }, poseConstraint);
  },
};
