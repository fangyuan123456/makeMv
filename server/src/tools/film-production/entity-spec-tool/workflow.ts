/**
 * tools/film-production/entity-spec-tool/workflow.ts
 * 单实体视觉规格精细推演工作流 (Single Entity Spec Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import { EntitySpecInputSchema, entitySpecStep } from './steps/01-spec/index.js';
import { EntitySpecModifierInputSchema, entitySpecModifierStep } from './modifier/index.js';

export function createEntitySpecWorkflow() {
  return new Workflow({
    name: 'entity-spec-workflow',
    triggerSchema: EntitySpecInputSchema,
  })
    .step(entitySpecStep)
    .commit();
}

export function createEntitySpecModifierWorkflow() {
  return new Workflow({
    name: 'entity-spec-modifier-workflow',
    triggerSchema: EntitySpecModifierInputSchema,
  })
    .step(entitySpecModifierStep)
    .commit();
}
