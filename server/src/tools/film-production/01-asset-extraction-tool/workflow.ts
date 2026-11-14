/**
 * tools/film-production/01-asset-extraction-tool/workflow.ts
 */

import { Workflow } from '@mastra/core/workflows';
import { AssetExtractionStepInputSchema, assetExtractionStep } from './steps/01-extract/index.js';

export function createAssetExtractionWorkflow() {
  return new Workflow({
    name: 'asset-extraction-workflow',
    triggerSchema: AssetExtractionStepInputSchema,
  })
    .step(assetExtractionStep)
    .commit();
}
