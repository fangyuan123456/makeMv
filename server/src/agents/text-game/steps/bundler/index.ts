/**
 * agents/text-game/steps/bundler/index.ts
 * 互动文游打包工序总装出口 (SSOT)
 */

export {
  bundlerStep,
  executeBundlerStep,
  assembleStandaloneTs,
  compileTsToJs,
  generateIndexHtml,
} from './step.js';

export {
  BundlerInputSchema,
  BundlerOutputSchema,
  type BundlerInput,
  type BundlerOutput,
} from './schema.js';
