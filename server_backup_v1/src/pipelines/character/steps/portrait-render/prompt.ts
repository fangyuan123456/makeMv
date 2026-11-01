/**
 * pipelines/character/steps/portrait-render/prompt.ts
 * 定妆照图像渲染提示词构建器 (SSOT)
 */

import type { VisualSpecData } from '../visual-spec/schema.js';

export function formatPortraitPrompt(spec: VisualSpecData, versionIndex: number = 1): string {
  const base = spec.positivePrompt.trim();
  const lighting = spec.lighting ? `, ${spec.lighting}` : '';
  const shotType = spec.shotType ? `, ${spec.shotType}` : '';
  const ratio = spec.aspectRatio ? ` --ar ${spec.aspectRatio.replace(':', ':')}` : ' --ar 16:9';

  const seedVariation = versionIndex > 1 ? `, subtle angle variation v${versionIndex}` : '';

  return `${base}${lighting}${shotType}${seedVariation}${ratio}`;
}

export function formatNegativePrompt(spec: VisualSpecData): string {
  return (
    spec.negativePrompt ||
    'low quality, blurry, deformed limbs, bad anatomy, anime, cartoon, sketch, duplicate head, extra fingers'
  );
}
