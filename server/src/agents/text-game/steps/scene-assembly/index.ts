/**
 * agents/text-game/steps/scene-assembly/index.ts
 * 分幕装配工序出口：正文 + 场景母本 + PRD 接线 → 分幕 JSON
 */

export {
  sceneAssemblyStep,
  executeSceneAssemblyStep,
  assembleScenes,
  buildScriptScene,
  parseStorySections,
  type ParsedStorySection,
} from './step.js';

export {
  SceneAssemblyInputSchema,
  SceneAssemblyOutputSchema,
  type SceneAssemblyInput,
  type SceneAssemblyOutput,
} from './schema.js';
