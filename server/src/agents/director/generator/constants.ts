/**
 * agents/director/generator/constants.ts
 * 影视工序与阶段映射权威常量表 (Stage Mapping Constants SSOT)
 *
 * 架构重构（法典 0.3/0.4 单一事实来源）：
 * 彻底移除手写死字典，全量常量 100% 由 Step Manifest 清单注册表动态派生。
 */

export {
  STEP_MANIFESTS,
  getStepManifest,
  getStepManifestByStage,
  buildLegalStepsPromptText,
  DERIVED_STAGE_SEQUENCE as STAGE_SEQUENCE,
  DERIVED_STAGE_TRANSITION_MAP as STAGE_TRANSITION_MAP,
  DERIVED_STAGE_OF_SKILL as STAGE_OF_SKILL,
  DERIVED_SKILL_OF_STAGE as SKILL_OF_STAGE,
  DERIVED_SKILL_TITLES as SKILL_TITLES,
  type StepManifest,
} from './manifest.js';
