/**
 * tools/film-production/01-asset-extraction-tool/index.ts
 * 视觉资产提炼工具 (Asset Extraction Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createAssetExtractionWorkflow } from './workflow.js';
import {
  AssetExtractionInputSchema,
  AssetExtractionOutputSchema,
  type AssetExtractionInput,
  type AssetExtractionOutput,
} from './steps/01-extract/index.js';

export * from './steps/01-extract/index.js';
export * from './workflow.js';

export class AssetExtractionTool extends BaseTaskTool<AssetExtractionInput, AssetExtractionOutput> {
  public readonly toolName = 'film.asset_extraction';
  public readonly description = '从剧本与 PRD 中提炼全剧角色、实物道具与场景外观设定及生图提示词 (纯文本提取)';

  protected buildWorkflow() {
    return createAssetExtractionWorkflow();
  }
}

export const assetExtractionTool = new AssetExtractionTool();
