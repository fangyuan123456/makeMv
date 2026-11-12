/**
 * agents/text-game/steps/entity-extract/index.ts
 * 全局角色一致性与道具字典提取工序总装出口 (SSOT)
 */

export {
  entityExtractStep,
  executeEntityExtractStep,
  createConceptArtDirectorAgent,
  EntityExtractInputSchema,
  type EntityExtractInput,
} from './step.js';

export {
  buildEntityExtractSystemPrompt,
  buildEntityExtractUserPrompt,
} from './prompt.js';
