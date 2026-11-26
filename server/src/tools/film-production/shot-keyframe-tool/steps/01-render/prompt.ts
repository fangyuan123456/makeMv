/**
 * tools/film-production/shot-keyframe-tool/steps/01-render/prompt.ts
 * 分镜关键帧提示词门面（委托给底层统一媒体语义编译器 media-semantic-compiler）
 */

import type { CinematicShotOrder } from '../../../../../project-store/contracts/film-production/film-spec.js';
import {
  buildMediaPromptFromReferences,
  type KeyframeReferenceEntry,
} from '../../../../../media/compiler/media-semantic-compiler.js';

export const KEYFRAME_IMAGE_SIZE = '1280*720';

export { type KeyframeReferenceEntry };

/**
 * 分镜关键帧生图提示词装配（向后兼容门面，统一收拢到底层 media 编译器）
 */
export function buildShotKeyframePrompt(
  shot: CinematicShotOrder,
  references: KeyframeReferenceEntry[] = [],
  overrideBasePrompt?: string,
  instruction?: string,
  entities?: any
): string {
  const rawBase = (overrideBasePrompt || shot.firstFramePrompt || `${shot.shotType} ${shot.cameraMovement}`).trim();
  return buildMediaPromptFromReferences(rawBase, references, instruction, entities);
}
