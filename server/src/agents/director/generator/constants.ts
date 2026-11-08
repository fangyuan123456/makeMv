/**
 * agents/director/generator/constants.ts
 * 生成轨常量兼容出口 (Generator Constants Compatibility Barrel)
 *
 * 这里只保留生成轨私有的「装配清单」导出（STEP_MANIFESTS / getStepManifest）
 * ——它们持有 Mastra Step 执行体，本来就该属于生成轨。
 *
 * 中立常量（STAGE_OF_SKILL / SKILL_OF_STAGE / STAGE_TRANSITION_MAP 等）
 * 统一从 ../constants.js 转发，单一事实来源仍是 catalog.ts。
 * 生成轨内部可以继续用本文件，外部消费方请直接引用 ../constants.js。
 */

export {
  STEP_MANIFESTS,
  getStepManifest,
  getStepManifestByStage,
  type StepManifest,
} from './manifest.js';

export {
  buildLegalStepsPromptText,
  STAGE_SEQUENCE,
  STAGE_TRANSITION_MAP,
  STAGE_OF_SKILL,
  SKILL_OF_STAGE,
  SKILL_TITLES,
} from '../constants.js';
