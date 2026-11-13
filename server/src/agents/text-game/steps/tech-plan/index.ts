/**
 * agents/text-game/steps/tech-plan/index.ts
 * 互动文游技术架构规划工序总装出口 (SSOT)
 */

export {
  techPlanStep,
  executeTechPlanStep,
  normalizeTechPlan,
  sortFilesByDependency,
  buildFallbackTechPlan,
  createTechArchitectAgent,
} from './step.js';

export {
  buildRuntimeFactsSection,
  buildRuntimeBehaviorRules,
  buildScreeningList,
} from './runtime-contract.js';

export {
  TechPlanInputSchema,
  TechPlanOutputSchema,
  TechFileSpecSchema,
  TechSymbolSpecSchema,
  TechMethodSpecSchema,
  type TechPlanInput,
  type TechPlanOutput,
  type TechFileSpec,
  type TechSymbolSpec,
  type TechMethodSpec,
} from './schema.js';
