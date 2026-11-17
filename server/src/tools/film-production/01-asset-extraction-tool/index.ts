/**
 * tools/film-production/01-asset-extraction-tool/index.ts
 * 视觉资产提炼工具 (Asset Extraction Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createAssetExtractionWorkflow, createAssetExtractionModifierWorkflow } from './workflow.js';
import {
  AssetExtractionInputSchema,
  AssetExtractionOutputSchema,
  type AssetExtractionInput,
  type AssetExtractionOutput,
} from './steps/01-extract/index.js';

export * from './steps/01-extract/index.js';
export * from './workflow.js';
export * from './modifier/index.js';

export class AssetExtractionTool extends BaseTaskTool<AssetExtractionInput, AssetExtractionOutput> {
  public readonly toolName = 'film.asset_extraction';
  public readonly description = '从剧本与 PRD 中提炼视觉资产；支持通过 mode=modify 新增或删除角色、场景';

  protected buildWorkflow(input?: AssetExtractionInput) {
    return input?.mode === 'modify'
      ? createAssetExtractionModifierWorkflow()
      : createAssetExtractionWorkflow();
  }
}

export const assetExtractionTool = new AssetExtractionTool();
