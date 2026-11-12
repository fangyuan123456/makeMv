/**
 * agents/text-game/steps/scene-packaging/index.ts
 * 分幕自包含切片打包工序总装出口 (SSOT)
 */

export {
  scenePackagingStep,
  executeScenePackagingStep,
  createScenePackagingAgent,
  parseStorySections,
  validateScenePointers,
  buildSceneInteractionFromPrd,
  buildDeterministicScenesFromPlanner,
  hydrateScenesWithPrd,
} from './step.js';

export {
  ScenePackagingInputSchema,
  ScenePackagingOutputSchema,
  type ScenePackagingInput,
  type ScenePackagingOutput,
} from './schema.js';

export {
  buildScenePackagingSystemPrompt,
  buildScenePackagingUserPrompt,
} from './prompt.js';
