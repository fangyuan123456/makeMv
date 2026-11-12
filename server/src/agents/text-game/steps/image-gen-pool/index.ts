/**
 * agents/text-game/steps/image-gen-pool/index.ts
 * 并发视觉资产池生图工序总装出口 (SSOT)
 */

export {
  imageGenPoolStep,
  executeImageGenPoolStep,
} from './step.js';

export {
  ImageGenPoolInputSchema,
  ImageGenPoolOutputSchema,
  type ImageGenPoolInput,
  type ImageGenPoolOutput,
} from './schema.js';
