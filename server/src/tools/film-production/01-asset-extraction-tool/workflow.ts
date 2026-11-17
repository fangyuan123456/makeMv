/**
 * tools/film-production/01-asset-extraction-tool/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import { AssetExtractionStepInputSchema, assetExtractionStep } from './steps/01-extract/index.js';
import { AssetExtractionModifierInputSchema, assetExtractionModifierStep } from './modifier/index.js';

export function createAssetExtractionWorkflow() {
  return new Workflow({
    name: 'asset-extraction-workflow',
    triggerSchema: AssetExtractionStepInputSchema,
  })
    .step(assetExtractionStep)
    .commit();
}

export function createAssetExtractionModifierWorkflow() {
  return new Workflow({
    name: 'asset-extraction-modifier-workflow',
    triggerSchema: AssetExtractionModifierInputSchema,
  })
    .step(assetExtractionModifierStep)
    .commit();
}
