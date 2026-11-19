import type { RenderProfile } from '../render.js';
import { buildSceneAtmospherePrompt, SCENE_ATMOSPHERE_NEGATIVE, SCENE_ATMOSPHERE_SIZE } from './prompt.js';

export const locationProfile: RenderProfile = {
  idKey: 'locationId',
  subfolder: 'assets/locations',
  size: SCENE_ATMOSPHERE_SIZE,
  mode: (hasReference) => hasReference ? 'scene_ref2i' : 'character_t2i',
  reference: (entity, isEdit) => isEdit ? entity.imageUrl || entity.referenceImageUrl : entity.referenceImageUrl,
  prompt: async (entity, artStyle, hasReference, target, edit) => ({
    text: target.customPrompt?.trim() || edit?.directedPrompt || buildSceneAtmospherePrompt(entity as any, artStyle, hasReference),
    negative: [target.customNegativePrompt || edit?.negativePrompt, SCENE_ATMOSPHERE_NEGATIVE].filter(Boolean).join('，'),
    savedPrompt: target.customPrompt?.trim() || edit?.directedPrompt,
  }),
};
