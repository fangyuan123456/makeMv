/**
 * agents/director/modifier/steps/image/keyframe-reference/keyframe-reference.modifier.ts
 * 关键帧单镜靶向微调、提示词重写与局部重绘引擎 (Keyframe Reference Modifier SSOT)
 */

import { KeyframeRenderer } from '../../../../../../media/index.js';
import type {
  KeyframeItem,
  KeyframePromptMeta,
} from '../../../../../../artifacts/keyframe-reference.js';

export interface RefineKeyframePromptOptions {
  existingShot: KeyframeItem;
  userFeedback?: string;
  fallbackVisualComposition?: string;
}

export function refineKeyframePrompt(options: RefineKeyframePromptOptions): {
  finalPrompt: string;
  meta: KeyframePromptMeta;
} {
  const { existingShot, userFeedback, fallbackVisualComposition } = options;
  const currentPrompt = existingShot.prompt || fallbackVisualComposition || existingShot.shotId;
  const finalPrompt = userFeedback ? `${currentPrompt}，${userFeedback}` : currentPrompt;

  const meta: KeyframePromptMeta = {
    prompt: finalPrompt || '',
    subjectAppearance: existingShot.subjectAppearance,
    sceneEnvironment: existingShot.sceneEnvironment || fallbackVisualComposition,
  };

  return {
    finalPrompt: finalPrompt || '',
    meta,
  };
}

export async function renderModifiedKeyframe(
  projectId: string,
  shot: any,
  finalPrompt: string,
  meta?: KeyframePromptMeta,
  options?: { isMock?: boolean }
): Promise<KeyframeItem> {
  const renderRes = await KeyframeRenderer.renderKeyframeImage(
    projectId,
    shot.shotId,
    '16:9',
    finalPrompt,
    options
  );

  return {
    shotId: shot.shotId,
    shotNumber: typeof shot.shotNumber === 'number' ? shot.shotNumber : 1,
    subjectAppearance: meta?.subjectAppearance,
    sceneEnvironment: meta?.sceneEnvironment || shot.visualComposition,
    prompt: finalPrompt,
    imageUrl: renderRes.url,
    aspectRatio: '16:9',
    status: 'ready' as const,
    isDegraded: renderRes.isDegraded,
    degradedReason: renderRes.degradedReason,
  };
}
