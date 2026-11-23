/**
 * tools/film-production/asset-manifest-tool/workflow.ts
 * 全剧资产清单工作流 (Asset Manifest Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import { AssetManifestInputSchema, assetManifestStep } from './steps/01-manifest/index.js';
import { AssetManifestModifierInputSchema, assetManifestModifierStep } from './modifier/index.js';

export function createAssetManifestWorkflow() {
  return new Workflow({
    name: 'asset-manifest-workflow',
    triggerSchema: AssetManifestInputSchema,
  })
    .step(assetManifestStep)
    .commit();
}

export function createAssetManifestModifierWorkflow() {
  return new Workflow({
    name: 'asset-manifest-modifier-workflow',
    triggerSchema: AssetManifestModifierInputSchema,
  })
    .step(assetManifestModifierStep)
    .commit();
}
