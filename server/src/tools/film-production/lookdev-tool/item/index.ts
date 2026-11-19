import type { RenderProfile } from '../render.js';
import { buildPropLookdevPrompt, PROP_LOOKDEV_NEGATIVE, PROP_LOOKDEV_SIZE } from './prompt.js';

export const itemProfile: RenderProfile = {
  idKey: 'itemId',
  subfolder: 'assets/entities',
  size: PROP_LOOKDEV_SIZE,
  mode: (hasReference) => hasReference ? 'scene_ref2i' : 'character_t2i',
  reference: (entity, isEdit) => isEdit ? entity.imageUrl || entity.referenceImageUrl : entity.referenceImageUrl,
  prompt: async (entity, artStyle, _hasReference, target, edit) => ({
    text: target.customPrompt?.trim() || edit?.directedPrompt || buildPropLookdevPrompt(entity as any, artStyle),
    negative: [target.customNegativePrompt || edit?.negativePrompt, PROP_LOOKDEV_NEGATIVE].filter(Boolean).join('，'),
    savedPrompt: target.customPrompt?.trim() || edit?.directedPrompt,
  }),
};
